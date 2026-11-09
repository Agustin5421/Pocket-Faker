use super::VisionConfig;
use crate::{capture, inference::Detection};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

pub struct PendingFrame {
    pub number: u64,
    pub timestamp_ms: i64,
    pub captured_at: String,
    pub image: RgbaImage,
    pub threshold: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    protocol: u32,
    #[serde(rename = "type")]
    kind: String,
    message: Option<String>,
    frame_number: Option<u64>,
    detections: Option<Vec<WireDetection>>,
    elapsed_ms: Option<f64>,
    track_epoch: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireDetection {
    id: usize,
    class_id: usize,
    label: String,
    confidence: f32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CharacterFrame {
    session_id: String,
    frame_number: u64,
    frame_width: u32,
    frame_height: u32,
    captured_at: String,
    full_frame_data_url: String,
    gameplay_detections: Vec<Detection>,
    gameplay_inference_ms: f64,
    backend_id: &'static str,
    track_epoch: u64,
}

type Pending = Arc<(Mutex<Option<PendingFrame>>, Condvar)>;

pub struct Sam3Worker {
    pending: Pending,
    stopped: Arc<AtomicBool>,
    child: Arc<Mutex<Child>>,
    join: Option<JoinHandle<()>>,
    last_queued: Option<Instant>,
    interval: Duration,
}

impl Sam3Worker {
    pub fn start(
        app: AppHandle,
        session_id: String,
        config: VisionConfig,
        cache_directory: &Path,
        replay_directory: &Path,
    ) -> Result<Self, String> {
        config.validate_checkpoint()?;
        fs::create_dir_all(cache_directory).map_err(|error| error.to_string())?;
        // Embed the worker so packaged apps do not depend on a source checkout.
        let worker_path = cache_directory.join("sam3-worker-v1.py");
        fs::write(
            &worker_path,
            include_str!("../../../scripts/sam3_worker.py"),
        )
        .map_err(|error| error.to_string())?;
        let stderr = File::create(replay_directory.join("sam3-worker.log"))
            .map_err(|error| error.to_string())?;
        let mut process = Command::new(&config.python_path)
            .arg("-u")
            .arg(&worker_path)
            .env("HF_HUB_OFFLINE", "1")
            .env("TRANSFORMERS_OFFLINE", "1")
            .env("PYTORCH_ENABLE_MPS_FALLBACK", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr)
            .spawn()
            .map_err(|error| format!("No se pudo iniciar Python para SAM 3: {error}"))?;
        let stdin = process.stdin.take().ok_or("SAM 3 stdin unavailable")?;
        let stdout = process.stdout.take().ok_or("SAM 3 stdout unavailable")?;
        let child = Arc::new(Mutex::new(process));
        let pending: Pending = Arc::new((Mutex::new(None), Condvar::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::sync_channel(1);
        let reader = thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                // Bound responses even when a dependency accidentally writes to stdout.
                let read = (&mut stdout)
                    .take(4 * 1024 * 1024)
                    .read_until(b'\n', &mut bytes);
                let response = match read {
                    Ok(0) => Err("SAM 3 worker closed its output".to_string()),
                    Ok(_) if bytes.last() == Some(&b'\n') => {
                        serde_json::from_slice::<Response>(&bytes)
                            .map_err(|error| format!("Invalid SAM 3 response: {error}"))
                    }
                    Ok(_) => Err("SAM 3 response exceeds limit".to_string()),
                    Err(error) => Err(error.to_string()),
                };
                let failed = response.is_err();
                if sender.send(response).is_err() || failed {
                    break;
                }
            }
        });
        let thread_pending = pending.clone();
        let thread_stopped = stopped.clone();
        let thread_child = child.clone();
        let interval = Duration::from_secs_f64(1.0 / f64::from(config.max_fps));
        let replay_directory = replay_directory.to_path_buf();
        let join = thread::spawn(move || {
            let result = process_frames(
                &app,
                &session_id,
                &config,
                stdin,
                receiver,
                &thread_pending,
                &thread_stopped,
                &replay_directory,
            );
            let cancelled = thread_stopped.swap(true, Ordering::Relaxed);
            if let Ok(mut child) = thread_child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let _ = reader.join();
            if let Err(error) = result {
                if !cancelled {
                    let _ = app.emit(
                        "character-status",
                        serde_json::json!({
                            "sessionId": session_id, "phase": "error", "message": error,
                        }),
                    );
                }
            }
        });
        Ok(Self {
            pending,
            stopped,
            child,
            join: Some(join),
            last_queued: None,
            interval,
        })
    }

    pub fn queue(&mut self, frame: &RgbaImage, number: u64, captured_at: String, threshold: f32) {
        let due = self
            .last_queued
            .is_none_or(|time| time.elapsed() >= self.interval);
        if due && !self.stopped.load(Ordering::Relaxed) {
            if let Ok(mut pending) = self.pending.0.lock() {
                // Replace the waiting frame; never accumulate a video backlog.
                *pending = Some(PendingFrame {
                    number,
                    timestamp_ms: chrono::Utc::now().timestamp_millis(),
                    captured_at,
                    image: frame.clone(),
                    threshold,
                });
                self.last_queued = Some(Instant::now());
                self.pending.1.notify_one();
            }
        }
    }
}

impl Drop for Sam3Worker {
    fn drop(&mut self) {
        {
            let _slot = self.pending.0.lock();
            self.stopped.store(true, Ordering::Relaxed);
            self.pending.1.notify_all();
        }
        // Kill before joining: loading/inference/blocked IPC must not delay Stop.
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn response(receiver: &mpsc::Receiver<Result<Response, String>>) -> Result<Response, String> {
    let response = receiver
        .recv_timeout(Duration::from_secs(180))
        .map_err(|error| format!("SAM 3 worker timeout/disconnected: {error}"))??;
    if response.protocol != 1 {
        Err("Unsupported SAM 3 worker protocol".into())
    } else if response.kind == "error" {
        Err(response.message.unwrap_or_else(|| "SAM 3 failed".into()))
    } else {
        Ok(response)
    }
}

fn validate_detections(items: Vec<WireDetection>) -> Result<Vec<Detection>, String> {
    items
        .into_iter()
        .map(|item| {
            let values = [item.confidence, item.x, item.y, item.width, item.height];
            let valid = values.iter().all(|value| value.is_finite())
                && (0.0..=1.0).contains(&item.confidence)
                && item.x >= 0.0
                && item.y >= 0.0
                && item.width > 0.0
                && item.height > 0.0
                && item.x + item.width <= 1.00001
                && item.y + item.height <= 1.00001
                && item.label.len() <= 128;
            if valid {
                Ok(Detection {
                    id: item.id,
                    class_id: item.class_id,
                    label: item.label,
                    confidence: item.confidence,
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height,
                })
            } else {
                Err("Invalid SAM 3 normalized detection".into())
            }
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn process_frames(
    app: &AppHandle,
    session_id: &str,
    config: &VisionConfig,
    mut stdin: std::process::ChildStdin,
    receiver: mpsc::Receiver<Result<Response, String>>,
    pending: &Pending,
    stopped: &AtomicBool,
    replay_directory: &Path,
) -> Result<(), String> {
    serde_json::to_writer(&mut stdin, config).map_err(|error| error.to_string())?;
    stdin.write_all(b"\n").map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())?;
    let ready = response(&receiver)?;
    if ready.kind != "ready" {
        return Err("SAM 3 did not acknowledge startup".into());
    }
    app.emit(
        "character-status",
        serde_json::json!({
            "sessionId": session_id, "phase": "ready", "device": config.device,
        }),
    )
    .map_err(|error| error.to_string())?;
    let mut log = File::create(replay_directory.join("character-detections.jsonl"))
        .map_err(|error| error.to_string())?;
    while !stopped.load(Ordering::Relaxed) {
        let mut slot = pending.0.lock().map_err(|error| error.to_string())?;
        while slot.is_none() && !stopped.load(Ordering::Relaxed) {
            slot = pending.1.wait(slot).map_err(|error| error.to_string())?;
        }
        let frame = slot.take();
        drop(slot);
        if let Some(frame) = frame {
            let header = serde_json::to_vec(&serde_json::json!({
                "protocol": 1, "width": frame.image.width(), "height": frame.image.height(),
                "frameNumber": frame.number, "timestampMs": frame.timestamp_ms, "threshold": frame.threshold,
            })).map_err(|error| error.to_string())?;
            if frame.image.as_raw().len() > 64 * 1024 * 1024 {
                return Err("SAM 3 frame exceeds 64 MiB".into());
            }
            stdin
                .write_all(&(header.len() as u32).to_be_bytes())
                .map_err(|error| error.to_string())?;
            stdin
                .write_all(&header)
                .map_err(|error| error.to_string())?;
            stdin
                .write_all(frame.image.as_raw())
                .map_err(|error| error.to_string())?;
            stdin.flush().map_err(|error| error.to_string())?;
            let result = response(&receiver)?;
            let elapsed = result.elapsed_ms.ok_or("Missing SAM 3 latency")?;
            if result.kind != "frame"
                || result.frame_number != Some(frame.number)
                || !elapsed.is_finite()
                || elapsed < 0.0
            {
                return Err("SAM 3 response does not match submitted frame".into());
            }
            let detections = validate_detections(result.detections.ok_or("Missing detections")?)?;
            let epoch = result.track_epoch.ok_or("Missing track epoch")?;
            serde_json::to_writer(&mut log, &serde_json::json!({
                "sessionId": session_id, "frameNumber": frame.number, "capturedAt": frame.captured_at,
                "backendId": "sam3", "trackEpoch": epoch, "inferenceMs": elapsed, "detections": detections,
            })).map_err(|error| error.to_string())?;
            log.write_all(b"\n").map_err(|error| error.to_string())?;
            log.flush().map_err(|error| error.to_string())?;
            if !stopped.load(Ordering::Relaxed) {
                app.emit(
                    "character-frame",
                    CharacterFrame {
                        session_id: session_id.into(),
                        frame_number: frame.number,
                        frame_width: frame.image.width(),
                        frame_height: frame.image.height(),
                        captured_at: frame.captured_at,
                        full_frame_data_url: capture::encode_preview_data_url(&frame.image, 960)?,
                        gameplay_detections: detections,
                        gameplay_inference_ms: elapsed,
                        backend_id: "sam3",
                        track_epoch: epoch,
                    },
                )
                .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_out_of_bounds_or_non_finite_worker_boxes() {
        let item = |x| WireDetection {
            id: 4,
            class_id: 1,
            label: "target".into(),
            confidence: 0.8,
            x,
            y: 0.1,
            width: 0.2,
            height: 0.3,
        };
        assert!(validate_detections(vec![item(0.1)]).is_ok());
        assert!(validate_detections(vec![item(0.9)]).is_err());
        assert!(validate_detections(vec![item(f32::NAN)]).is_err());
    }
    #[test]
    fn rejects_error_and_wrong_protocol_responses() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(
                serde_json::from_str::<Response>(r#"{"protocol":2,"type":"ready"}"#)
                    .map_err(|e| e.to_string()),
            )
            .unwrap();
        assert!(response(&receiver).is_err());
        sender
            .send(
                serde_json::from_str::<Response>(
                    r#"{"protocol":1,"type":"error","message":"MPS failed"}"#,
                )
                .map_err(|e| e.to_string()),
            )
            .unwrap();
        assert_eq!(response(&receiver).err().unwrap(), "MPS failed");
    }
}
