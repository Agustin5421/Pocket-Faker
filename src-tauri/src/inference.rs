use image::{imageops::FilterType, RgbaImage};
use ort::{
    ep,
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};
use serde::Serialize;
use std::{path::Path, time::Instant};

pub const INPUT_SIZE: u32 = 256;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub id: usize,
    pub class_id: usize,
    pub label: String,
    pub confidence: f32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

pub struct InferenceResult {
    pub detections: Vec<Detection>,
    pub elapsed_ms: f64,
}

pub struct YoloDetector {
    session: Session,
    labels: Vec<String>,
}

impl YoloDetector {
    pub fn load(model_path: &Path, cache_directory: &Path) -> Result<Self, String> {
        let builder = Session::builder().map_err(|error| error.to_string())?;

        #[cfg(target_os = "macos")]
        let builder = builder
            .with_execution_providers([ep::CoreML::default()
                .with_static_input_shapes(true)
                .with_model_format(ep::coreml::ModelFormat::MLProgram)
                .with_compute_units(ep::coreml::ComputeUnits::All)
                .with_model_cache_dir(cache_directory.display().to_string())
                .build()
                .fail_silently()])
            .map_err(|error| error.to_string())?;

        let session = builder
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|error| error.to_string())?
            .commit_from_file(model_path)
            .map_err(|error| format!("could not load {}: {error}", model_path.display()))?;
        let labels = session
            .metadata()
            .ok()
            .and_then(|metadata| metadata.custom("names"))
            .map(|raw| parse_label_metadata(&raw))
            .unwrap_or_default();

        Ok(Self { session, labels })
    }

    pub fn infer(&mut self, image: &RgbaImage, threshold: f32) -> Result<InferenceResult, String> {
        let started_at = Instant::now();
        let resized = image::imageops::resize(image, INPUT_SIZE, INPUT_SIZE, FilterType::Triangle);
        let plane_size = (INPUT_SIZE * INPUT_SIZE) as usize;
        let mut input = vec![0.0_f32; plane_size * 3];

        for (index, pixel) in resized.pixels().enumerate() {
            input[index] = f32::from(pixel[0]) / 255.0;
            input[plane_size + index] = f32::from(pixel[1]) / 255.0;
            input[(plane_size * 2) + index] = f32::from(pixel[2]) / 255.0;
        }

        let tensor = Tensor::from_array(([1, 3, INPUT_SIZE as usize, INPUT_SIZE as usize], input))
            .map_err(|error| error.to_string())?;
        let output = {
            let outputs = self
                .session
                .run(ort::inputs!["images" => tensor])
                .map_err(|error| error.to_string())?;
            let (_, output) = outputs["output0"]
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?;
            output.to_vec()
        };
        let detections = output
            .chunks_exact(6)
            .enumerate()
            .filter_map(|(index, row)| self.parse_detection(index, row, threshold))
            .collect();

        Ok(InferenceResult {
            detections,
            elapsed_ms: started_at.elapsed().as_secs_f64() * 1_000.0,
        })
    }

    fn parse_detection(&self, index: usize, row: &[f32], threshold: f32) -> Option<Detection> {
        let confidence = row[4];
        let class_id = row[5].round().max(0.0) as usize;
        let has_detection = confidence >= threshold && row[2] > row[0] && row[3] > row[1];

        has_detection.then(|| {
            let scale = INPUT_SIZE as f32;
            let x1 = (row[0] / scale).clamp(0.0, 1.0);
            let y1 = (row[1] / scale).clamp(0.0, 1.0);
            let x2 = (row[2] / scale).clamp(0.0, 1.0);
            let y2 = (row[3] / scale).clamp(0.0, 1.0);
            let label = self
                .labels
                .get(class_id)
                .cloned()
                .unwrap_or_else(|| format!("class-{class_id}"));

            Detection {
                id: index,
                class_id,
                label,
                confidence,
                x: x1,
                y: y1,
                width: x2 - x1,
                height: y2 - y1,
            }
        })
    }
}

fn parse_label_metadata(raw: &str) -> Vec<String> {
    let mut indexed_labels = raw
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .split(',')
        .filter_map(|entry| {
            let (index, label) = entry.split_once(':')?;
            let index = index
                .trim()
                .trim_matches(['\'', '"'])
                .parse::<usize>()
                .ok()?;
            let label = label.trim().trim_matches(['\'', '"']).to_string();
            Some((index, label))
        })
        .collect::<Vec<_>>();
    indexed_labels.sort_by_key(|(index, _)| *index);
    indexed_labels.into_iter().map(|(_, label)| label).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ultralytics_label_metadata() {
        let labels = parse_label_metadata("{0: 'Aatrox', 1: 'Ahri', 2: 'Akali'}");
        assert_eq!(labels, ["Aatrox", "Ahri", "Akali"]);
    }

    #[test]
    #[ignore = "requires the local exported model"]
    fn loads_and_runs_local_minimap_model() {
        let project_directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("Tauri crate should be inside the project");
        let model_path = project_directory.join("yolo11x-minimap.onnx");
        let cache_directory = std::env::temp_dir().join("pocket-faker-ort-test-cache");
        let mut detector = YoloDetector::load(&model_path, &cache_directory)
            .expect("local model should load in ONNX Runtime");
        let result = detector
            .infer(&RgbaImage::new(INPUT_SIZE, INPUT_SIZE), 0.35)
            .expect("blank frame inference should succeed");

        assert!(result.elapsed_ms >= 0.0);
    }
}
