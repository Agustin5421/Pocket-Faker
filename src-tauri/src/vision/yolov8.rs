use crate::inference::{Detection, InferenceResult};
use image::{imageops::FilterType, Rgba, RgbaImage};
use ort::{
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};
use std::{path::Path, time::Instant};

pub const INPUT_WIDTH: u32 = 1280;
pub const INPUT_HEIGHT: u32 = 736;
pub const MODEL_FILE: &str = "models/aatrox-yolov8n-synthetic-v1.onnx";

pub struct AatroxYoloDetector {
    session: Session,
}

#[derive(Clone, Copy)]
struct Letterbox {
    scale: f32,
    left: u32,
    top: u32,
    source_width: u32,
    source_height: u32,
}

impl Letterbox {
    fn new(width: u32, height: u32) -> Result<Self, String> {
        if width == 0 || height == 0 {
            return Err("YOLOv8 requiere un frame con dimensiones positivas".into());
        }
        let scale = (INPUT_WIDTH as f32 / width as f32).min(INPUT_HEIGHT as f32 / height as f32);
        let resized_width = (width as f32 * scale).round() as u32;
        let resized_height = (height as f32 * scale).round() as u32;
        Ok(Self {
            scale,
            left: (INPUT_WIDTH - resized_width) / 2,
            top: (INPUT_HEIGHT - resized_height) / 2,
            source_width: width,
            source_height: height,
        })
    }

    fn decode(&self, values: [f32; 4], confidence: f32) -> Option<Detection> {
        let [cx, cy, width, height] = values;
        if values.iter().any(|v| !v.is_finite()) || width <= 0.0 || height <= 0.0 {
            return None;
        }
        let map_x = |x: f32| {
            ((x - self.left as f32) / self.scale / self.source_width as f32).clamp(0.0, 1.0)
        };
        let map_y = |y: f32| {
            ((y - self.top as f32) / self.scale / self.source_height as f32).clamp(0.0, 1.0)
        };
        let x1 = map_x(cx - width / 2.0);
        let x2 = map_x(cx + width / 2.0);
        let y1 = map_y(cy - height / 2.0);
        let y2 = map_y(cy + height / 2.0);
        (x2 > x1 && y2 > y1).then(|| Detection {
            id: 0,
            class_id: 0,
            label: "Aatrox".into(),
            confidence,
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1,
        })
    }
}

impl AatroxYoloDetector {
    pub fn load(path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|e| e.to_string())?
            .commit_from_file(path)
            .map_err(|e| format!("No se pudo cargar {}: {e}", path.display()))?;
        let names = session
            .metadata()
            .ok()
            .and_then(|metadata| metadata.custom("names"));
        if !matches!(names.as_deref(), Some("{0: 'aatrox'}" | "{0: \"aatrox\"}")) {
            return Err("El modelo YOLOv8 debe contener únicamente la clase 0: aatrox".into());
        }
        Ok(Self { session })
    }

    pub fn infer(&mut self, frame: &RgbaImage, threshold: f32) -> Result<InferenceResult, String> {
        let started = Instant::now();
        let (transform, input) = prepare_input(frame)?;
        let tensor =
            Tensor::from_array(([1, 3, INPUT_HEIGHT as usize, INPUT_WIDTH as usize], input))
                .map_err(|e| e.to_string())?;
        let detections = {
            let outputs = self
                .session
                .run(ort::inputs!["images" => tensor])
                .map_err(|e| e.to_string())?;
            let (shape, values) = outputs["output0"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            if shape.len() != 3 || shape[0] != 1 || shape[1] != 5 || shape[2] <= 0 {
                return Err(format!(
                    "Salida YOLOv8 incompatible: {shape:?}; se esperaba [1,5,N]"
                ));
            }
            decode_output(values, shape[2] as usize, threshold, transform)?
        };
        Ok(InferenceResult {
            detections,
            elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }
}

fn prepare_input(frame: &RgbaImage) -> Result<(Letterbox, Vec<f32>), String> {
    let transform = Letterbox::new(frame.width(), frame.height())?;
    let resized = image::imageops::resize(
        frame,
        (frame.width() as f32 * transform.scale).round() as u32,
        (frame.height() as f32 * transform.scale).round() as u32,
        FilterType::Triangle,
    );
    let mut canvas = RgbaImage::from_pixel(INPUT_WIDTH, INPUT_HEIGHT, Rgba([114, 114, 114, 255]));
    image::imageops::replace(
        &mut canvas,
        &resized,
        transform.left.into(),
        transform.top.into(),
    );
    let plane = (INPUT_WIDTH * INPUT_HEIGHT) as usize;
    let mut input = vec![0.0_f32; plane * 3];
    for (index, pixel) in canvas.pixels().enumerate() {
        for channel in 0..3 {
            input[channel * plane + index] = f32::from(pixel[channel]) / 255.0;
        }
    }
    Ok((transform, input))
}

fn iou(a: &Detection, b: &Detection) -> f32 {
    let width = ((a.x + a.width).min(b.x + b.width) - a.x.max(b.x)).max(0.0);
    let height = ((a.y + a.height).min(b.y + b.height) - a.y.max(b.y)).max(0.0);
    let intersection = width * height;
    intersection / (a.width * a.height + b.width * b.height - intersection).max(f32::EPSILON)
}

fn decode_output(
    values: &[f32],
    count: usize,
    threshold: f32,
    transform: Letterbox,
) -> Result<Vec<Detection>, String> {
    if count == 0 || values.len() != count * 5 {
        return Err("Cantidad de valores YOLOv8 incompatible".into());
    }
    let mut candidates = (0..count)
        .filter_map(|index| {
            let score = values[4 * count + index];
            if !score.is_finite() || score < threshold || !(0.0..=1.0).contains(&score) {
                return None;
            }
            transform.decode(
                [
                    values[index],
                    values[count + index],
                    values[2 * count + index],
                    values[3 * count + index],
                ],
                score,
            )
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    candidates.truncate(300);
    let mut selected: Vec<Detection> = Vec::new();
    for mut candidate in candidates {
        if selected
            .iter()
            .all(|previous| iou(previous, &candidate) <= 0.5)
        {
            candidate.id = selected.len();
            selected.push(candidate);
            if selected.len() == 100 {
                break;
            }
        }
    }
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preprocessing_preserves_model_resolution_rgb_order_and_letterbox_padding() {
        let frame = RgbaImage::from_pixel(1280, 720, Rgba([255, 128, 0, 255]));
        let (transform, input) = prepare_input(&frame).unwrap();
        let plane = (INPUT_WIDTH * INPUT_HEIGHT) as usize;
        assert_eq!(input.len(), plane * 3);
        assert_eq!((transform.left, transform.top), (0, 8));
        let first_pixel = (8 * INPUT_WIDTH) as usize;
        assert_eq!(input[first_pixel], 1.0);
        assert_eq!(input[plane + first_pixel], 128.0 / 255.0);
        assert_eq!(input[2 * plane + first_pixel], 0.0);
        for channel in 0..3 {
            assert_eq!(input[channel * plane], 114.0 / 255.0);
            assert_eq!(input[(channel + 1) * plane - 1], 114.0 / 255.0);
        }
        assert!(prepare_input(&RgbaImage::new(0, 1)).is_err());
    }

    #[test]
    #[ignore = "requires local model and POCKET_FAKER_YOLO_TEST_IMAGE; reports actual latency"]
    fn measures_real_frame_latency() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let path = std::env::var("POCKET_FAKER_YOLO_TEST_IMAGE").unwrap();
        let frame = image::open(path).unwrap().to_rgba8();
        let mut detector = AatroxYoloDetector::load(&root.join(MODEL_FILE)).unwrap();
        for iteration in 0..3 {
            let started = Instant::now();
            let _ = prepare_input(&frame).unwrap();
            let preprocessing_ms = started.elapsed().as_secs_f64() * 1000.0;
            let result = detector.infer(&frame, 0.25).unwrap();
            let preview_started = Instant::now();
            crate::capture::encode_preview_data_url(&frame, 960).unwrap();
            let preview_ms = preview_started.elapsed().as_secs_f64() * 1000.0;
            eprintln!("sample={iteration} source={}x{} preprocessing_ms={preprocessing_ms:.1} total_ms={:.1} preview_ms={preview_ms:.1}", frame.width(), frame.height(), result.elapsed_ms);
        }
    }

    #[test]
    fn removes_letterbox_padding_and_preserves_two_distinct_champions() {
        let transform = Letterbox::new(1920, 1080).unwrap();
        assert_eq!(transform.top, 8);
        let result = decode_output(
            &[
                320.0, 320.5, 900.0, // cx
                368.0, 368.5, 368.0, // cy
                100.0, 100.0, 100.0, 144.0, 144.0, 144.0, 0.9, 0.8, 0.7,
            ],
            3,
            0.5,
            transform,
        )
        .unwrap();
        assert_eq!(result.len(), 2);
        assert!((result[0].y - 0.4).abs() < 0.001);
        assert!((result[0].height - 0.2).abs() < 0.001);
        assert_eq!(result[0].class_id, 0);
        assert_eq!(result[1].id, 1);
    }

    #[test]
    fn rejects_invalid_scores_shapes_and_padding_only_boxes() {
        let transform = Letterbox::new(1280, 720).unwrap();
        assert!(decode_output(&[], 0, 0.5, transform).is_err());
        assert!(
            decode_output(&[20.0, 2.0, 5.0, 2.0, 0.9], 1, 0.5, transform)
                .unwrap()
                .is_empty()
        );
        assert!(
            decode_output(&[20.0, 20.0, 5.0, 5.0, f32::NAN], 1, 0.5, transform)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    #[ignore = "requires a locally trained YOLOv8 model"]
    fn loads_trained_model_and_detects_synthetic_positive() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let mut detector = AatroxYoloDetector::load(&root.join(MODEL_FILE)).unwrap();
        let image_path = std::env::var("POCKET_FAKER_YOLO_TEST_IMAGE")
            .expect("Set a labelled positive image path");
        let frame = image::open(&image_path).unwrap().to_rgba8();
        let result = detector.infer(&frame, 0.25).unwrap();
        let label_path =
            Path::new(&image_path.replace("/images/", "/labels/")).with_extension("txt");
        let values = std::fs::read_to_string(label_path)
            .unwrap()
            .split_whitespace()
            .map(|value| value.parse::<f32>().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(values.len(), 5);
        let expected = Detection {
            id: 0,
            class_id: 0,
            label: "Aatrox".into(),
            confidence: 1.0,
            x: values[1] - values[3] / 2.0,
            y: values[2] - values[4] / 2.0,
            width: values[3],
            height: values[4],
        };
        assert!(
            result.detections.iter().any(|d| iou(d, &expected) >= 0.5),
            "Trained model must overlap labelled synthetic target at IoU >= 0.5"
        );
        assert!(result
            .detections
            .iter()
            .all(|d| d.label == "Aatrox" && d.width > 0.0 && d.height > 0.0));
    }
}
