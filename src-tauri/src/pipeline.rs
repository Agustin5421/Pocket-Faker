use crate::{
    capture::{self, CaptureSource},
    gameplay::AatroxDetector,
    inference::{Detection, YoloDetector},
    storage::Database,
    vision::{self, sam3::Sam3Worker, yolov8::AatroxYoloDetector, CharacterBackend, VisionConfig},
};
use chrono::Utc;
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender, TrySendError},
        Arc, Mutex, RwLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStatus {
    pub phase: String,
    pub running: bool,
    pub model_loaded: bool,
    pub gameplay_model_loaded: bool,
    pub source: Option<CaptureSource>,
    pub session_id: Option<String>,
    pub message: Option<String>,
}

impl Default for PipelineStatus {
    fn default() -> Self {
        Self {
            phase: "idle".to_string(),
            running: false,
            model_loaded: false,
            gameplay_model_loaded: false,
            source: None,
            session_id: None,
            message: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub source_path: String,
    pub runtime_path: String,
    pub source_exists: bool,
    pub runtime_exists: bool,
    pub source_size_bytes: Option<u64>,
    pub runtime_size_bytes: Option<u64>,
    pub input_size: u32,
    pub execution_provider: &'static str,
    pub gameplay_runtime_path: String,
    pub gameplay_runtime_exists: bool,
    pub gameplay_runtime_size_bytes: Option<u64>,
    pub gameplay_input_width: u32,
    pub gameplay_input_height: u32,
    pub gameplay_execution_provider: &'static str,
    pub character_models: Vec<CharacterModelInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterModelInfo {
    pub id: CharacterBackend,
    pub name: &'static str,
    pub runtime_path: String,
    pub runtime_exists: bool,
    pub runtime_size_bytes: Option<u64>,
    pub input_width: u32,
    pub input_height: u32,
}

// Keep the character pipeline available for a later project phase.
const CHARACTER_DETECTION_ENABLED: bool = false;

enum GameplayDetector {
    Grid(AatroxDetector),
    Yolov8(AatroxYoloDetector),
}

impl GameplayDetector {
    fn infer(
        &mut self,
        frame: &image::RgbaImage,
        threshold: f32,
    ) -> Result<crate::inference::InferenceResult, String> {
        match self {
            Self::Grid(detector) => detector.infer(frame, threshold),
            Self::Yolov8(detector) => detector.infer(frame, threshold),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFrameEvent {
    pub backend_id: CharacterBackend,
    pub session_id: String,
    pub frame_number: u64,
    pub frame_width: u32,
    pub frame_height: u32,
    pub captured_at: String,
    pub source: CaptureSource,
    pub full_frame_data_url: String,
    pub minimap_data_url: String,
    pub detections: Vec<Detection>,
    pub gameplay_detections: Vec<Detection>,
    pub gameplay_tracks: Vec<vision::tracking::CharacterTrack>,
    pub gameplay_tracking_candidates: Vec<Detection>,
    pub character_tracking_enabled: bool,
    pub tracking_ms: f64,
    pub mean_confidence: f32,
    pub capture_ms: f64,
    pub inference_ms: f64,
    pub gameplay_inference_ms: f64,
    pub processing_ms: f64,
    pub refresh_fps: Option<f64>,
}

struct PipelineWorker {
    stop: Arc<AtomicBool>,
    join: JoinHandle<()>,
}

struct ReplayFrame {
    image: image::RgbaImage,
    path: PathBuf,
}

struct ReplayWriter {
    sender: SyncSender<ReplayFrame>,
    join: JoinHandle<Result<(), String>>,
}

impl ReplayWriter {
    fn start() -> Self {
        let (sender, receiver) = mpsc::sync_channel::<ReplayFrame>(4);
        let join = thread::spawn(move || {
            for frame in receiver {
                let bytes = capture::encode_jpeg(&frame.image, 82)?;
                fs::write(frame.path, bytes).map_err(|error| error.to_string())?;
            }
            Ok(())
        });
        Self { sender, join }
    }

    fn queue(&self, frame: ReplayFrame) -> Result<bool, String> {
        match self.sender.try_send(frame) {
            Ok(()) => Ok(true),
            Err(TrySendError::Full(_)) => Ok(false),
            Err(TrySendError::Disconnected(_)) => {
                Err("the replay writer stopped unexpectedly".to_string())
            }
        }
    }

    fn finish(self) -> Result<(), String> {
        drop(self.sender);
        self.join
            .join()
            .map_err(|_| "the replay writer terminated unexpectedly".to_string())?
    }
}

pub struct PipelineController {
    worker: Mutex<Option<PipelineWorker>>,
    status: Arc<RwLock<PipelineStatus>>,
    database_path: PathBuf,
    replay_directory: PathBuf,
    source_model_path: PathBuf,
    runtime_model_path: PathBuf,
    gameplay_model_path: PathBuf,
    yolov8_model_path: PathBuf,
    model_cache_directory: PathBuf,
    config_path: PathBuf,
    config: Mutex<VisionConfig>,
}

impl PipelineController {
    pub fn new(
        database_path: PathBuf,
        replay_directory: PathBuf,
        project_directory: PathBuf,
        model_cache_directory: PathBuf,
        config_path: PathBuf,
    ) -> Result<Self, String> {
        let config = vision::load_config(&config_path)?;
        Ok(Self {
            worker: Mutex::new(None),
            status: Arc::new(RwLock::new(PipelineStatus::default())),
            database_path,
            replay_directory,
            source_model_path: project_directory.join("yolo11x-minimap.pt"),
            runtime_model_path: project_directory.join("yolo11x-minimap.onnx"),
            gameplay_model_path: project_directory.join("models/aatrox-grid-v1.onnx"),
            yolov8_model_path: project_directory.join(vision::yolov8::MODEL_FILE),
            model_cache_directory,
            config_path,
            config: Mutex::new(config),
        })
    }

    pub fn config(&self) -> Result<VisionConfig, String> {
        self.config
            .lock()
            .map(|config| config.clone())
            .map_err(|error| error.to_string())
    }

    pub fn set_config(&self, config: VisionConfig) -> Result<VisionConfig, String> {
        let worker = self.worker.lock().map_err(|error| error.to_string())?;
        if worker
            .as_ref()
            .is_some_and(|worker| !worker.join.is_finished())
        {
            Err("Detenga la captura antes de cambiar el modelo del personaje".into())
        } else {
            let mut current = self.config.lock().map_err(|error| error.to_string())?;
            vision::save_config(&self.config_path, &config)?;
            *current = config.clone();
            Ok(config)
        }
    }

    pub fn status(&self) -> PipelineStatus {
        self.status
            .read()
            .map(|status| status.clone())
            .unwrap_or_default()
    }

    pub fn model_info(&self) -> ModelInfo {
        ModelInfo {
            source_path: self.source_model_path.display().to_string(),
            runtime_path: self.runtime_model_path.display().to_string(),
            source_exists: self.source_model_path.is_file(),
            runtime_exists: self.runtime_model_path.is_file(),
            source_size_bytes: file_size(&self.source_model_path),
            runtime_size_bytes: file_size(&self.runtime_model_path),
            input_size: crate::inference::INPUT_SIZE,
            execution_provider: if cfg!(target_os = "macos") {
                "CoreML with CPU fallback"
            } else {
                "ONNX Runtime CPU"
            },
            gameplay_runtime_path: self.gameplay_model_path.display().to_string(),
            gameplay_runtime_exists: self.gameplay_model_path.is_file(),
            gameplay_runtime_size_bytes: file_size(&self.gameplay_model_path),
            gameplay_input_width: crate::gameplay::INPUT_WIDTH,
            gameplay_input_height: crate::gameplay::INPUT_HEIGHT,
            gameplay_execution_provider: "ONNX Runtime CPU",
            character_models: [
                (
                    CharacterBackend::Current,
                    "Actual — Aatrox ONNX",
                    &self.gameplay_model_path,
                    crate::gameplay::INPUT_WIDTH,
                    crate::gameplay::INPUT_HEIGHT,
                ),
                (
                    CharacterBackend::Yolov8,
                    "YOLOv8n — Aatrox sintético v1 (experimental)",
                    &self.yolov8_model_path,
                    vision::yolov8::INPUT_WIDTH,
                    vision::yolov8::INPUT_HEIGHT,
                ),
            ]
            .into_iter()
            .map(
                |(id, name, path, input_width, input_height)| CharacterModelInfo {
                    id,
                    name,
                    runtime_path: path.display().to_string(),
                    runtime_exists: path.is_file(),
                    runtime_size_bytes: file_size(path),
                    input_width,
                    input_height,
                },
            )
            .collect(),
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        source_id: String,
        confidence: f32,
        gameplay_confidence: f32,
        frames_per_second: u32,
    ) -> Result<PipelineStatus, String> {
        let mut worker_slot = self.worker.lock().map_err(|error| error.to_string())?;
        if worker_slot
            .as_ref()
            .is_some_and(|worker| worker.join.is_finished())
        {
            if let Some(worker) = worker_slot.take() {
                let _ = worker.join.join();
            }
        }
        if worker_slot.is_some() {
            return Err("a capture pipeline is already running".to_string());
        }
        if !self.runtime_model_path.is_file() {
            return Err(format!(
                "runtime model not found: {}",
                self.runtime_model_path.display()
            ));
        }
        let character_config = if CHARACTER_DETECTION_ENABLED {
            let config = self.config()?;
            config.validate_checkpoint()?;
            config
        } else {
            VisionConfig::default()
        };
        let gameplay_model_path = match character_config.backend {
            CharacterBackend::Yolov8 => self.yolov8_model_path.clone(),
            _ => self.gameplay_model_path.clone(),
        };
        if CHARACTER_DETECTION_ENABLED
            && character_config.backend != CharacterBackend::Sam3
            && !gameplay_model_path.is_file()
        {
            return Err(format!(
                "Aatrox runtime model not found: {}",
                gameplay_model_path.display()
            ));
        }
        if !capture::capture_permission_status().granted {
            return Err(
                "Screen Recording permission is required. Enable Pocket Faker in macOS System Settings, then restart the app."
                    .to_string(),
            );
        }

        let source = capture::list_sources()?
            .into_iter()
            .find(|candidate| candidate.id == source_id)
            .ok_or_else(|| "the selected capture source is not available".to_string())?;
        let database = Database::new(self.database_path.clone());
        let session = database
            .create_session(
                Some(format!("{} · {}", source.app_name, source.title)),
                &self.replay_directory,
            )
            .map_err(|error| error.to_string())?;
        let replay_path = PathBuf::from(&session.replay_path);
        let stop = Arc::new(AtomicBool::new(false));
        let initial_status = PipelineStatus {
            phase: "loading-model".to_string(),
            running: true,
            model_loaded: false,
            gameplay_model_loaded: false,
            source: Some(source.clone()),
            session_id: Some(session.id.clone()),
            message: Some("Loading minimap model".to_string()),
        };
        self.set_status(&app, initial_status.clone());

        let worker_stop = stop.clone();
        let worker_status = self.status.clone();
        let database_path = self.database_path.clone();
        let model_path = self.runtime_model_path.clone();
        let cache_directory = self.model_cache_directory.clone();
        let session_id = session.id;
        let worker_source = source;
        let target_fps = frames_per_second.clamp(1, 30);
        let threshold = confidence.clamp(0.05, 0.95);
        let gameplay_threshold = gameplay_confidence.clamp(0.05, 0.95);
        let worker_app = app.clone();

        let join = thread::spawn(move || {
            let result = run_pipeline(
                &worker_app,
                worker_stop,
                worker_status.clone(),
                worker_source,
                session_id.clone(),
                replay_path,
                model_path,
                gameplay_model_path,
                character_config,
                cache_directory,
                threshold,
                gameplay_threshold,
                target_fps,
            );
            let database = Database::new(database_path);

            match result {
                Ok(()) => {
                    let _ = database.finish_session(&session_id);
                    update_status(
                        &worker_app,
                        &worker_status,
                        PipelineStatus {
                            phase: "idle".to_string(),
                            running: false,
                            model_loaded: false,
                            gameplay_model_loaded: false,
                            source: None,
                            session_id: Some(session_id),
                            message: Some("Capture stopped".to_string()),
                        },
                    );
                }
                Err(error) => {
                    let _ = database.fail_session(&session_id);
                    let _ = worker_app.emit("pipeline-error", error.clone());
                    update_status(
                        &worker_app,
                        &worker_status,
                        PipelineStatus {
                            phase: "error".to_string(),
                            running: false,
                            model_loaded: false,
                            gameplay_model_loaded: false,
                            source: None,
                            session_id: Some(session_id),
                            message: Some(error),
                        },
                    );
                }
            }
        });

        *worker_slot = Some(PipelineWorker { stop, join });
        Ok(initial_status)
    }

    pub fn stop(&self) -> Result<PipelineStatus, String> {
        let mut worker_slot = self.worker.lock().map_err(|error| error.to_string())?;
        // Keep the slot locked until shutdown completes, preventing overlapping sessions.
        if let Some(worker) = worker_slot.take() {
            worker.stop.store(true, Ordering::Relaxed);
            worker
                .join
                .join()
                .map_err(|_| "capture worker terminated unexpectedly".to_string())?;
        }

        Ok(self.status())
    }

    fn set_status(&self, app: &AppHandle, status: PipelineStatus) {
        update_status(app, &self.status, status);
    }
}

#[allow(clippy::too_many_arguments)]
fn run_pipeline(
    app: &AppHandle,
    stop: Arc<AtomicBool>,
    status: Arc<RwLock<PipelineStatus>>,
    source: CaptureSource,
    session_id: String,
    replay_path: PathBuf,
    model_path: PathBuf,
    gameplay_model_path: PathBuf,
    character_config: VisionConfig,
    cache_directory: PathBuf,
    confidence: f32,
    gameplay_confidence: f32,
    frames_per_second: u32,
) -> Result<(), String> {
    fs::create_dir_all(&cache_directory).map_err(|error| error.to_string())?;
    let frame_directory = replay_path.join("frames");
    fs::create_dir_all(&frame_directory).map_err(|error| error.to_string())?;
    let mut event_log = BufWriter::new(
        File::create(replay_path.join("detections.jsonl")).map_err(|error| error.to_string())?,
    );
    let mut detector = YoloDetector::load(&model_path, &cache_directory)?;
    if CHARACTER_DETECTION_ENABLED {
        fs::write(
            replay_path.join("character-config.json"),
            serde_json::to_vec_pretty(&character_config).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    }
    let mut gameplay_detector = if CHARACTER_DETECTION_ENABLED {
        match character_config.backend {
            CharacterBackend::Current => Some(GameplayDetector::Grid(AatroxDetector::load(
                &gameplay_model_path,
                &cache_directory.join("aatrox"),
            )?)),
            CharacterBackend::Yolov8 => Some(GameplayDetector::Yolov8(AatroxYoloDetector::load(
                &gameplay_model_path,
            )?)),
            CharacterBackend::Sam3 => None,
        }
    } else {
        None
    };
    let mut sam3 =
        if CHARACTER_DETECTION_ENABLED && character_config.backend == CharacterBackend::Sam3 {
            match Sam3Worker::start(
                app.clone(),
                session_id.clone(),
                character_config.clone(),
                &cache_directory.join("sam3"),
                &replay_path,
            ) {
                Ok(worker) => Some(worker),
                Err(error) => {
                    let _ = app.emit(
                        "character-status",
                        serde_json::json!({
                            "sessionId": session_id, "phase": "error", "message": error,
                        }),
                    );
                    None
                }
            }
        } else {
            None
        };
    let target = capture::find_target(&source.id, frames_per_second)?;
    let replay_writer = ReplayWriter::start();
    update_status(
        app,
        &status,
        PipelineStatus {
            phase: "capturing".to_string(),
            running: true,
            model_loaded: true,
            gameplay_model_loaded: gameplay_detector.is_some(),
            source: Some(source.clone()),
            session_id: Some(session_id.clone()),
            message: Some("Capture and minimap active".to_string()),
        },
    );

    let frame_interval = Duration::from_secs_f64(1.0 / f64::from(frames_per_second));
    let mut frame_number = 0_u64;
    let mut previous_frame_at: Option<Instant> = None;
    let mut tracker = vision::tracking::CharacterTracker::default();
    let tracking_started_at = Instant::now();
    let tracking_enabled = CHARACTER_DETECTION_ENABLED
        && character_config.backend == CharacterBackend::Yolov8
        && character_config.tracking_enabled;
    let processing_result = (|| -> Result<(), String> {
        while !stop.load(Ordering::Relaxed) {
            let loop_started_at = Instant::now();
            let capture_started_at = Instant::now();
            let full_frame = target.capture_image()?;
            let tracking_frame_at = tracking_started_at.elapsed();
            let capture_ms = capture_started_at.elapsed().as_secs_f64() * 1_000.0;
            let captured_at = Utc::now().to_rfc3339();
            let minimap = capture::crop_minimap(&full_frame);
            let inference = detector.infer(&minimap, confidence)?;
            let gameplay_inference = if let Some(detector) = gameplay_detector.as_mut() {
                let threshold = if tracking_enabled {
                    gameplay_confidence.min(vision::tracking::LOW_CONFIDENCE)
                } else {
                    gameplay_confidence
                };
                detector.infer(&full_frame, threshold)?
            } else {
                crate::inference::InferenceResult {
                    detections: Vec::new(),
                    elapsed_ms: 0.0,
                }
            };
            let tracking_step_started = Instant::now();
            let gameplay_tracks = if tracking_enabled {
                tracker.update(
                    &gameplay_inference.detections,
                    gameplay_confidence,
                    tracking_frame_at,
                    full_frame.dimensions(),
                )
            } else {
                Vec::new()
            };
            let tracking_ms = tracking_step_started.elapsed().as_secs_f64() * 1_000.0;
            let gameplay_tracking_candidates = if tracking_enabled {
                gameplay_inference.detections.clone()
            } else {
                Vec::new()
            };
            let gameplay_detections = gameplay_inference
                .detections
                .into_iter()
                .filter(|detection| detection.confidence >= gameplay_confidence)
                .collect();
            if let Some(worker) = sam3.as_mut() {
                worker.queue(
                    &full_frame,
                    frame_number,
                    captured_at.clone(),
                    gameplay_confidence,
                );
            }
            let frame_file_name = format!("frame-{frame_number:08}.jpg");
            let full_frame_data_url = capture::encode_preview_data_url(&full_frame, 960)?;
            let minimap_data_url = capture::encode_preview_data_url(&minimap, 420)?;
            let mean_confidence = if inference.detections.is_empty() {
                0.0
            } else {
                inference
                    .detections
                    .iter()
                    .map(|detection| detection.confidence)
                    .sum::<f32>()
                    / inference.detections.len() as f32
            };
            let processed_at = Instant::now();
            let event = CaptureFrameEvent {
                backend_id: character_config.backend.clone(),
                session_id: session_id.clone(),
                frame_number,
                frame_width: full_frame.width(),
                frame_height: full_frame.height(),
                captured_at: captured_at.clone(),
                source: source.clone(),
                full_frame_data_url,
                minimap_data_url,
                detections: inference.detections,
                gameplay_detections,
                gameplay_tracks,
                gameplay_tracking_candidates,
                character_tracking_enabled: tracking_enabled,
                tracking_ms,
                mean_confidence,
                capture_ms,
                inference_ms: inference.elapsed_ms,
                gameplay_inference_ms: gameplay_inference.elapsed_ms,
                processing_ms: processed_at.duration_since(loop_started_at).as_secs_f64() * 1_000.0,
                refresh_fps: previous_frame_at.map(|previous| {
                    1.0 / processed_at
                        .duration_since(previous)
                        .as_secs_f64()
                        .max(f64::EPSILON)
                }),
            };
            let recording_queued = replay_writer.queue(ReplayFrame {
                image: full_frame,
                path: frame_directory.join(&frame_file_name),
            })?;
            let recorded_event = serde_json::json!({
                "sessionId": event.session_id,
                "frameNumber": event.frame_number,
                "frameWidth": event.frame_width,
                "frameHeight": event.frame_height,
                "capturedAt": captured_at,
                "file": recording_queued.then(|| format!("frames/{frame_file_name}")),
                "recordingDropped": !recording_queued,
                "captureMs": capture_ms,
                "inferenceMs": event.inference_ms,
                "detections": event.detections,
                "backendId": event.backend_id,
                "characterDetectionEnabled": CHARACTER_DETECTION_ENABLED,
                "characterAsync": CHARACTER_DETECTION_ENABLED && character_config.backend == CharacterBackend::Sam3,
                "gameplayInferenceMs": event.gameplay_inference_ms,
                "processingMs": event.processing_ms,
                "refreshFps": event.refresh_fps,
                "gameplayDetections": event.gameplay_detections,
                "gameplayTracks": event.gameplay_tracks,
                "gameplayTrackingCandidates": event.gameplay_tracking_candidates,
                "characterTrackingEnabled": event.character_tracking_enabled,
                "trackingMs": event.tracking_ms,
            });
            serde_json::to_writer(&mut event_log, &recorded_event)
                .map_err(|error| error.to_string())?;
            event_log
                .write_all(b"\n")
                .map_err(|error| error.to_string())?;
            event_log.flush().map_err(|error| error.to_string())?;
            app.emit("capture-frame", event)
                .map_err(|error| error.to_string())?;
            previous_frame_at = Some(processed_at);
            frame_number += 1;

            let elapsed = loop_started_at.elapsed();
            if elapsed < frame_interval {
                thread::sleep(frame_interval - elapsed);
            }
        }

        Ok(())
    })();

    let writer_result = replay_writer.finish();
    processing_result?;
    writer_result
}

fn update_status(
    app: &AppHandle,
    status_handle: &Arc<RwLock<PipelineStatus>>,
    status: PipelineStatus,
) {
    if let Ok(mut current) = status_handle.write() {
        *current = status.clone();
    }
    let _ = app.emit("pipeline-status", status);
}

fn file_size(path: &PathBuf) -> Option<u64> {
    fs::metadata(path).ok().map(|metadata| metadata.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn character_catalog_reports_yolov8_independently_of_legacy_model() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(root.join("models")).unwrap();
        let controller = PipelineController::new(
            root.join("database.sqlite"),
            root.join("replays"),
            root.clone(),
            root.join("cache"),
            root.join("vision.json"),
        )
        .unwrap();
        let info = controller.model_info();
        assert_eq!(info.character_models.len(), 2);
        assert!(info.character_models.iter().all(|m| !m.runtime_exists));
        // Catalog checks artifact presence; inference validates the actual graph on load.
        fs::write(root.join(vision::yolov8::MODEL_FILE), []).unwrap();
        let info = controller.model_info();
        let yolo = info
            .character_models
            .iter()
            .find(|m| m.id == CharacterBackend::Yolov8)
            .unwrap();
        assert!(yolo.runtime_exists);
        assert_eq!((yolo.input_width, yolo.input_height), (1280, 736));
        assert!(!info.gameplay_runtime_exists);
        assert_eq!(
            controller.config().unwrap().backend,
            CharacterBackend::Current
        );
        fs::remove_dir_all(root).unwrap();
    }
}
