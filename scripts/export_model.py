from pathlib import Path

from ultralytics import YOLO


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_MODEL = PROJECT_ROOT / "yolo11x-minimap.pt"
OUTPUT_MODEL = PROJECT_ROOT / "yolo11x-minimap.onnx"


def main() -> None:
    if not SOURCE_MODEL.exists():
        raise FileNotFoundError(f"Model not found: {SOURCE_MODEL}")

    model = YOLO(SOURCE_MODEL)
    exported_path = Path(
        model.export(
            format="onnx",
            imgsz=256,
            opset=18,
            simplify=True,
            nms=True,
            dynamic=False,
            device="cpu",
        )
    )

    if exported_path.resolve() != OUTPUT_MODEL.resolve():
        exported_path.replace(OUTPUT_MODEL)

    print(OUTPUT_MODEL)


if __name__ == "__main__":
    main()
