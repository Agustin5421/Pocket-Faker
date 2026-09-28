use crate::inference::{Detection, InferenceResult};
use image::{imageops::FilterType, RgbaImage};
use ort::{
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};
use std::{path::Path, time::Instant};

pub const INPUT_WIDTH: u32 = 384;
pub const INPUT_HEIGHT: u32 = 216;
const GRID_WIDTH: usize = 48;
const GRID_HEIGHT: usize = 27;

pub struct AatroxDetector {
    session: Session,
}

impl AatroxDetector {
    pub fn load(model_path: &Path, _cache_directory: &Path) -> Result<Self, String> {
        let builder = Session::builder().map_err(|error| error.to_string())?;
        // CoreML rejects a padding operation in this exported graph; CPU is reliable.
        let session = builder
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|error| error.to_string())?
            .commit_from_file(model_path)
            .map_err(|error| format!("could not load {}: {error}", model_path.display()))?;
        Ok(Self { session })
    }

    pub fn infer(&mut self, frame: &RgbaImage, threshold: f32) -> Result<InferenceResult, String> {
        let started_at = Instant::now();
        let resized =
            image::imageops::resize(frame, INPUT_WIDTH, INPUT_HEIGHT, FilterType::Triangle);
        let mut input = Vec::with_capacity((INPUT_WIDTH * INPUT_HEIGHT * 3) as usize);
        for pixel in resized.pixels() {
            input.extend_from_slice(&pixel.0[..3]);
        }

        let tensor =
            Tensor::from_array(([1, INPUT_HEIGHT as usize, INPUT_WIDTH as usize, 3], input))
                .map_err(|error| error.to_string())?;
        let (boxes, logits) = {
            let outputs = self
                .session
                .run(ort::inputs!["image" => tensor])
                .map_err(|error| error.to_string())?;
            let (_, boxes) = outputs["box"]
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?;
            let (_, logits) = outputs["objectness"]
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?;
            (boxes.to_vec(), logits.to_vec())
        };
        let detections = decode_grid(&boxes, &logits, threshold)?;
        Ok(InferenceResult {
            detections,
            elapsed_ms: started_at.elapsed().as_secs_f64() * 1_000.0,
        })
    }
}

fn decode_grid(boxes: &[f32], logits: &[f32], threshold: f32) -> Result<Vec<Detection>, String> {
    let cells = GRID_WIDTH * GRID_HEIGHT;
    if boxes.len() != cells * 4 || logits.len() != cells {
        return Err(format!(
            "unexpected Aatrox output shapes: box={}, objectness={}",
            boxes.len(),
            logits.len()
        ));
    }
    let Some((index, &logit)) = logits
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
    else {
        return Ok(Vec::new());
    };
    let confidence = 1.0 / (1.0 + (-logit).exp());
    if !confidence.is_finite() || confidence < threshold {
        return Ok(Vec::new());
    }

    let x_cell = index % GRID_WIDTH;
    let y_cell = index / GRID_WIDTH;
    let values = &boxes[index * 4..index * 4 + 4];
    if values.iter().any(|value| !value.is_finite()) {
        return Ok(Vec::new());
    }
    let center_x = (x_cell as f32 + values[0]) / GRID_WIDTH as f32;
    let center_y = (y_cell as f32 + values[1]) / GRID_HEIGHT as f32;
    let x1 = (center_x - values[2] / 2.0).clamp(0.0, 1.0);
    let y1 = (center_y - values[3] / 2.0).clamp(0.0, 1.0);
    let x2 = (center_x + values[2] / 2.0).clamp(0.0, 1.0);
    let y2 = (center_y + values[3] / 2.0).clamp(0.0, 1.0);
    if x2 <= x1 || y2 <= y1 {
        return Ok(Vec::new());
    }
    Ok(vec![Detection {
        id: 0,
        class_id: 1,
        label: "Aatrox".to_string(),
        confidence,
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
    }])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_one_normalized_box() {
        let mut logits = vec![-10.0; GRID_WIDTH * GRID_HEIGHT];
        let mut boxes = vec![0.0; GRID_WIDTH * GRID_HEIGHT * 4];
        let index = 8 * GRID_WIDTH + 12;
        logits[index] = 2.0;
        boxes[index * 4..index * 4 + 4].copy_from_slice(&[0.5, 0.5, 0.1, 0.2]);
        let detections = decode_grid(&boxes, &logits, 0.5).unwrap();
        assert_eq!(detections.len(), 1);
        assert_eq!(detections[0].label, "Aatrox");
        assert!(detections[0].x >= 0.0 && detections[0].x + detections[0].width <= 1.0);
        assert!(detections[0].y >= 0.0 && detections[0].y + detections[0].height <= 1.0);
        assert!(decode_grid(&boxes, &logits, 0.95).unwrap().is_empty());
    }

    #[test]
    fn rejects_unexpected_output_shape() {
        assert!(decode_grid(&[], &[], 0.5).is_err());
    }

    #[test]
    #[ignore = "requires the local exported model"]
    fn loads_and_runs_local_aatrox_model() {
        let project_directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("Tauri crate should be inside the project");
        let model_path = project_directory.join("models/aatrox-grid-v1.onnx");
        let cache_directory = std::env::temp_dir().join("pocket-faker-aatrox-ort-test-cache");
        let mut detector = AatroxDetector::load(&model_path, &cache_directory)
            .expect("local Aatrox model should load in ONNX Runtime");
        let result = detector
            .infer(&RgbaImage::new(1280, 720), 0.5)
            .expect("blank frame inference should succeed");
        assert!(result.elapsed_ms >= 0.0);
        assert!(result.detections.len() <= 1);
    }
}
