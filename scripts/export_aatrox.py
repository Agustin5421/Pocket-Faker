"""Export the trained TensorFlow Aatrox grid detector for Pocket Faker."""

import argparse
from pathlib import Path

import onnx
import tensorflow as tf


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_MODEL = PROJECT_ROOT / "models" / "aatrox-grid-v1.onnx"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True, help="Trained best.keras path")
    parser.add_argument("--output", type=Path, default=OUTPUT_MODEL)
    args = parser.parse_args()

    model = tf.keras.models.load_model(args.model, compile=False)
    model(tf.zeros([1, 216, 384, 3], tf.uint8), training=False)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    model.export(
        args.output,
        format="onnx",
        input_signature=[tf.TensorSpec([1, 216, 384, 3], tf.uint8, name="image")],
    )

    exported = onnx.load(str(args.output))
    onnx.checker.check_model(exported)
    input_names = [value.name for value in exported.graph.input]
    output_names = {value.name for value in exported.graph.output}
    if input_names != ["image"] or output_names != {"box", "objectness"}:
        raise RuntimeError(f"Unexpected ONNX interface: {input_names} -> {output_names}")
    print(args.output)


if __name__ == "__main__":
    main()
