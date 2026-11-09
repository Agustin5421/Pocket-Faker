"""Validate and install ChampionForge's trained YOLOv8 export, optionally following one run."""
import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path

MODEL_ID = 'aatrox-yolov8n-synthetic-v1'


def install(run, model_directory):
    import numpy as np
    import onnx
    import onnxruntime as ort
    metadata_path = run / 'model.json'
    if not metadata_path.exists():
        return False
    metadata = json.loads(metadata_path.read_text())
    source = run / f'{MODEL_ID}.onnx'
    if metadata.get('id') != MODEL_ID or metadata.get('classNames') != {'0': 'aatrox'}:
        raise ValueError('Expected a trained Aatrox-only YOLOv8 export')
    actual_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if metadata.get('onnxSha256') != actual_hash:
        return False  # Export is being published; retry after matching metadata arrives.
    model_directory.mkdir(parents=True, exist_ok=True)
    target = model_directory / source.name
    target_metadata = model_directory / f'{MODEL_ID}.json'
    if target.exists() and target_metadata.exists():
        existing = json.loads(target_metadata.read_text())
        if existing.get('onnxSha256') == actual_hash and existing.get('trainingComplete') == metadata.get('trainingComplete'):
            return False
    graph = onnx.load(source)
    onnx.checker.check_model(graph)
    names = {p.key: p.value for p in graph.metadata_props}.get('names', '')
    if names not in ("{0: 'aatrox'}", '{0: "aatrox"}'):
        raise ValueError(f'Unexpected ONNX class names: {names}')
    session = ort.InferenceSession(str(source), providers=['CPUExecutionProvider'])
    if session.get_inputs()[0].shape != [1, 3, 736, 1280]:
        raise ValueError('Unexpected model input size/layout')
    result = session.run(None, {'images': np.zeros((1, 3, 736, 1280), dtype=np.float32)})[0]
    if result.ndim != 3 or result.shape[:2] != (1, 5) or not np.isfinite(result).all():
        raise ValueError('Unexpected YOLOv8 output shape or non-finite predictions')
    staging = target.with_suffix('.onnx.partial')
    shutil.copy2(source, staging)
    staging.replace(target)
    metadata['installedAtUnix'] = time.time()
    metadata['sourceRun'] = str(run)
    metadata['onnxRuntimeSmokePassed'] = True
    metadata['onnxRuntimeOutputShape'] = list(result.shape)
    temporary = target_metadata.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(metadata, indent=2) + '\n')
    temporary.replace(target_metadata)
    print(f"Installed {target.name}, exported after epoch {metadata['exportedAfterEpoch']}, complete={metadata['trainingComplete']}", flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--model-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'models')
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    run = args.run.resolve()
    while True:
        try:
            install(run, args.model_dir.resolve())
        except (OSError, ValueError, RuntimeError) as error:
            if not args.watch:
                raise
            print(f'Export not yet importable: {error}', flush=True)
        if not args.watch:
            break
        state_path = run / 'training-status.json'
        if state_path.exists():
            state = json.loads(state_path.read_text())
            if state['status'] in ('complete', 'failed'):
                if state['status'] == 'failed':
                    raise SystemExit(f"Training failed: {state.get('error')}")
                install(run, args.model_dir.resolve())
                print('Training complete; final trained model installed', flush=True)
                break
        time.sleep(15)


if __name__ == '__main__':
    main()
