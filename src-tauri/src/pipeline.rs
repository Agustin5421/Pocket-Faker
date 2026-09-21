use crate::{
    capture::{self, CaptureSource},
    inference::{Detection, YoloDetector},
    storage::Database,
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
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFrameEvent {
    pub session_id: String,
    pub frame_number: u64,
    pub captured_at: String,
    pub source: CaptureSource,
    pub full_frame_data_url: String,
    pub minimap_data_url: String,
    pub detections: Vec<Detection>,
    pub mean_confidence: f32,
    pub capture_ms: f64,
    pub inference_ms: f64,
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
    model_cache_directory: PathBuf,
}

impl PipelineController {
    pub fn new(
        database_path: PathBuf,
        replay_directory: PathBuf,
        project_directory: PathBuf,
        model_cache_directory: PathBuf,
    ) -> Self {
        Self {
            worker: Mutex::new(None),
            status: Arc::new(RwLock::new(PipelineStatus::default())),
            database_path,
            replay_directory,
            source_model_path: project_directory.join("yolo11x-minimap.pt"),
            runtime_model_path: project_directory.join("yolo11x-minimap.onnx"),
            model_cache_directory,
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
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        source_id: String,
        confidence: f32,
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
            source: Some(source.clone()),
            session_id: Some(session.id.clone()),
            message: Some("Loading YOLO minimap model".to_string()),
        };
        self.set_status(&app, initial_status.clone());

        let worker_stop = stop.clone();
        let worker_status = self.status.clone();
        let database_path = self.database_path.clone();
        let model_path = self.runtime_model_path.clone();
        let cache_directory = self.model_cache_directory.clone();
        let session_id = session.id;
        let worker_source = source;
        let target_fps = frames_per_second.clamp(1, 10);
        let threshold = confidence.clamp(0.05, 0.95);
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
                cache_directory,
                threshold,
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
        let worker = self
            .worker
            .lock()
            .map_err(|error| error.to_string())?
            .take();

        if let Some(worker) = worker {
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
    cache_directory: PathBuf,
    confidence: f32,
    frames_per_second: u32,
) -> Result<(), String> {
    fs::create_dir_all(&cache_directory).map_err(|error| error.to_string())?;
    let frame_directory = replay_path.join("frames");
    fs::create_dir_all(&frame_directory).map_err(|error| error.to_string())?;
    let mut event_log = BufWriter::new(
        File::create(replay_path.join("detections.jsonl")).map_err(|error| error.to_string())?,
    );
    let mut detector = YoloDetector::load(&model_path, &cache_directory)?;
    let target = capture::find_target(&source.id, frames_per_second)?;
    let replay_writer = ReplayWriter::start();
    update_status(
        app,
        &status,
        PipelineStatus {
            phase: "capturing".to_string(),
            running: true,
            model_loaded: true,
            source: Some(source.clone()),
            session_id: Some(session_id.clone()),
            message: Some("Capture and minimap inference active".to_string()),
        },
    );

    let frame_interval = Duration::from_secs_f64(1.0 / f64::from(frames_per_second));
    let mut frame_number = 0_u64;
    let processing_result = (|| -> Result<(), String> {
        while !stop.load(Ordering::Relaxed) {
            let loop_started_at = Instant::now();
            let capture_started_at = Instant::now();
            let full_frame = target.capture_image()?;
            let capture_ms = capture_started_at.elapsed().as_secs_f64() * 1_000.0;
            let minimap = capture::crop_minimap(&full_frame);
            let inference = detector.infer(&minimap, confidence)?;
            let captured_at = Utc::now().to_rfc3339();
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
            let event = CaptureFrameEvent {
                session_id: session_id.clone(),
                frame_number,
                captured_at: captured_at.clone(),
                source: source.clone(),
                full_frame_data_url,
                minimap_data_url,
                detections: inference.detections,
                mean_confidence,
                capture_ms,
                inference_ms: inference.elapsed_ms,
            };
            let recording_queued = replay_writer.queue(ReplayFrame {
                image: full_frame,
                path: frame_directory.join(&frame_file_name),
            })?;
            let recorded_event = serde_json::json!({
                "sessionId": event.session_id,
                "frameNumber": event.frame_number,
                "capturedAt": captured_at,
                "file": recording_queued.then(|| format!("frames/{frame_file_name}")),
                "recordingDropped": !recording_queued,
                "captureMs": capture_ms,
                "inferenceMs": event.inference_ms,
                "detections": event.detections,
            });
            serde_json::to_writer(&mut event_log, &recorded_event)
                .map_err(|error| error.to_string())?;
            event_log
                .write_all(b"\n")
                .map_err(|error| error.to_string())?;
            event_log.flush().map_err(|error| error.to_string())?;
            app.emit("capture-frame", event)
                .map_err(|error| error.to_string())?;
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
