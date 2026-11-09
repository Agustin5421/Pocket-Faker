"""Offline SAM 3 streaming worker. stdout is reserved for protocol JSON lines."""
import contextlib
import json
import math
import os
import struct
import sys
import time

PROTOCOL = 1
MAX_FRAME_BYTES = 64 * 1024 * 1024


def read_exact(stream, size):
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))
        if not chunk:
            raise EOFError("IPC input closed")
        chunks.extend(chunk)
    return bytes(chunks)


def read_frame(stream):
    length = struct.unpack(">I", read_exact(stream, 4))[0]
    if not 0 < length <= 65536:
        raise ValueError("Invalid frame header size")
    header = json.loads(read_exact(stream, length))
    width, height = header["width"], header["height"]
    size = width * height * 4
    if header.get("protocol") != PROTOCOL or width <= 0 or height <= 0 or size > MAX_FRAME_BYTES:
        raise ValueError("Invalid frame dimensions or protocol")
    return header, read_exact(stream, size)


def normalized_detections(boxes, scores, ids, width, height, threshold, label):
    detections = []
    for box, score, track_id in zip(boxes, scores, ids):
        values = [float(value) for value in box]
        score = float(score)
        if len(values) != 4 or not all(math.isfinite(value) for value in [*values, score]):
            raise ValueError("Non-finite SAM 3 output")
        x1, y1, x2, y2 = values
        x1, x2 = [min(1.0, max(0.0, x / width)) for x in (x1, x2)]
        y1, y2 = [min(1.0, max(0.0, y / height)) for y in (y1, y2)]
        if score >= threshold and x2 > x1 and y2 > y1:
            detections.append(dict(id=int(track_id), classId=1, label=label,
                                   confidence=score, x=x1, y=y1, width=x2-x1, height=y2-y1))
    return detections


def send(stream, value):
    stream.write(json.dumps(dict(protocol=PROTOCOL, **value), allow_nan=False) + "\n")
    stream.flush()


def run(config, source, output):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"
    # Device errors stay visible rather than silently switching computation to CPU.
    import torch
    from PIL import Image
    from transformers import Sam3VideoModel, Sam3VideoProcessor

    device = config["device"]
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS unavailable; configure CPU explicitly")
    checkpoint = config["checkpointPath"]
    processor = Sam3VideoProcessor.from_pretrained(checkpoint, local_files_only=True)
    model = Sam3VideoModel.from_pretrained(checkpoint, local_files_only=True).to(device).eval()
    send(output, dict(type="ready", device=device))
    session = None
    count, epoch, previous_time, previous_size = 0, -1, None, None
    with torch.inference_mode():
        while True:
            header, rgba = read_frame(source)
            started = time.monotonic()
            size = (header["width"], header["height"])
            discontinuity = previous_time is not None and header["timestampMs"] - previous_time > 5000
            # Bound streaming history. Track IDs are scoped to this epoch.
            if session is None or count >= 60 or discontinuity or size != previous_size:
                session = processor.init_video_session(inference_device=device,
                    processing_device="cpu", video_storage_device="cpu",
                    max_vision_features_cache_size=1)
                session = processor.add_text_prompt(inference_session=session, text=config["prompt"])
                count = 0
                epoch += 1
            image = Image.frombytes("RGBA", size, rgba).convert("RGB")
            inputs = processor(images=image, device=device, return_tensors="pt").to(model.device)
            model_outputs = model(inference_session=session, frame=inputs.pixel_values[0], reverse=False)
            result = processor.postprocess_outputs(session, model_outputs, original_sizes=inputs.original_sizes)
            boxes = result["boxes"].detach().cpu().tolist()
            scores = result["scores"].detach().cpu().tolist()
            ids = result["object_ids"].detach().cpu().tolist()
            detections = normalized_detections(boxes, scores, ids, *size,
                                               header["threshold"], config["targetLabel"])
            send(output, dict(type="frame", frameNumber=header["frameNumber"], trackEpoch=epoch,
                              detections=detections, elapsedMs=(time.monotonic()-started)*1000))
            count += 1
            previous_time, previous_size = header["timestampMs"], size


def main():
    protocol_output = sys.stdout
    try:
        config = json.loads(sys.stdin.buffer.readline(65536))
        with contextlib.redirect_stdout(sys.stderr):
            run(config, sys.stdin.buffer, protocol_output)
    except EOFError:
        pass
    except Exception as error:
        send(protocol_output, dict(type="error", message=f"{type(error).__name__}: {error}"))
        sys.exit(1)


if __name__ == "__main__":
    main()
