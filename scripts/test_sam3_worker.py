"""Protocol/streaming regression tests; no weights or optional packages required."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sam3_worker', Path(__file__).with_name('sam3_worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def packet(number=0, timestamp=0, width=100, height=50):
    header = json.dumps(dict(protocol=1, frameNumber=number, timestampMs=timestamp,
                             width=width, height=height, threshold=0.5)).encode()
    return struct.pack('>I', len(header)) + header + bytes(width * height * 4)


class Tensor:
    def __init__(self, values):
        self.values = values

    def detach(self):
        return self

    def cpu(self):
        return self

    def tolist(self):
        return self.values


class Inputs:
    pixel_values = [None]
    original_sizes = [[50, 100]]

    def to(self, device):
        return self


class WorkerTests(unittest.TestCase):
    def test_truncated_and_oversized_packets_fail(self):
        with self.assertRaises(EOFError):
            worker.read_frame(io.BytesIO(packet()[:-1]))
        with self.assertRaises(ValueError):
            worker.read_frame(io.BytesIO(struct.pack('>I', 65537)))
        header = json.dumps(dict(protocol=1, width=100000, height=100000)).encode()
        with self.assertRaises(ValueError):
            worker.read_frame(io.BytesIO(struct.pack('>I', len(header)) + header))

    def test_normalization_threshold_and_nonfinite_outputs(self):
        boxes = [[10, 5, 30, 25], [10, 5, 30, 25]]
        result = worker.normalized_detections(boxes, [0.9, 0.1], [7, 8], 100, 50, 0.5, 'target')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 7)
        self.assertAlmostEqual(result[0]['x'], 0.1)
        self.assertAlmostEqual(result[0]['height'], 0.4)
        with self.assertRaises(ValueError):
            worker.normalized_detections([[float('nan'), 0, 1, 1]], [0.9], [0], 10, 10, 0.5, 'target')

    def test_streaming_protocol_persistent_session_and_gap_reset(self):
        sessions, prompts = [], []

        class Processor:
            @classmethod
            def from_pretrained(cls, path, local_files_only):
                self.assertTrue(local_files_only)
                return cls()

            def init_video_session(self, **options):
                session = object()
                sessions.append(session)
                return session

            def add_text_prompt(self, inference_session, text):
                prompts.append(text)
                return inference_session

            def __call__(self, **options):
                return Inputs()

            def postprocess_outputs(self, session, outputs, original_sizes):
                return dict(boxes=Tensor([[10, 5, 30, 25]]), scores=Tensor([0.9]), object_ids=Tensor([7]))

        class Model:
            device = 'cpu'

            @classmethod
            def from_pretrained(cls, path, local_files_only):
                return cls()

            def to(self, device):
                return self

            def eval(self):
                return self

            def __call__(self, **options):
                return None

        image = SimpleNamespace(convert=lambda mode: None)
        modules = dict(torch=SimpleNamespace(inference_mode=contextlib.nullcontext),
                       PIL=SimpleNamespace(Image=SimpleNamespace(frombytes=lambda *args: image)),
                       transformers=SimpleNamespace(Sam3VideoModel=Model, Sam3VideoProcessor=Processor))
        output = io.StringIO()
        config = dict(device='cpu', checkpointPath='/local', prompt='red warrior', targetLabel='target')
        with patch.dict(sys.modules, modules), self.assertRaises(EOFError):
            worker.run(config, io.BytesIO(packet(0, 0) + packet(9, 1000) + packet(20, 10000)), output)
        responses = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(responses[0]['type'], 'ready')
        self.assertEqual([item['frameNumber'] for item in responses[1:]], [0, 9, 20])
        self.assertEqual([item['trackEpoch'] for item in responses[1:]], [0, 0, 1])
        self.assertEqual(len(sessions), 2)
        self.assertEqual(prompts, ['red warrior', 'red warrior'])
        self.assertEqual(responses[1]['detections'][0]['id'], 7)


if __name__ == '__main__':
    unittest.main()
