mod capture;
mod inference;
mod pipeline;
mod storage;

use serde::Serialize;
use std::{path::PathBuf, sync::Arc};
use storage::{Database, SessionSummary};
use tauri::{AppHandle, Manager, State};

#[derive(Clone)]
struct AppState {
    database_path: PathBuf,
    replay_directory: PathBuf,
    pipeline: Arc<pipeline::PipelineController>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    app_name: &'static str,
    version: &'static str,
    runtime: &'static str,
    database_path: String,
    replay_directory: String,
    storage_ready: bool,
}

#[tauri::command]
fn get_app_info(state: State<'_, AppState>) -> Result<AppInfo, String> {
    let database = Database::new(state.database_path.clone());
    let storage_ready = database.health_check().map_err(|error| error.to_string())?;

    Ok(AppInfo {
        app_name: "Pocket Faker",
        version: env!("CARGO_PKG_VERSION"),
        runtime: "desktop",
        database_path: state.database_path.display().to_string(),
        replay_directory: state.replay_directory.display().to_string(),
        storage_ready,
    })
}

#[tauri::command]
fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionSummary>, String> {
    Database::new(state.database_path.clone())
        .list_sessions()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_session(
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<SessionSummary, String> {
    Database::new(state.database_path.clone())
        .create_session(title, &state.replay_directory)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn finish_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    Database::new(state.database_path.clone())
        .finish_session(&session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_capture_sources() -> Result<Vec<capture::CaptureSource>, String> {
    capture::list_sources()
}

#[tauri::command]
fn get_capture_permission_status() -> capture::CapturePermissionStatus {
    capture::capture_permission_status()
}

#[tauri::command]
fn request_capture_permission() -> capture::CapturePermissionStatus {
    capture::request_capture_permission()
}

#[tauri::command]
fn get_model_info(state: State<'_, AppState>) -> pipeline::ModelInfo {
    state.pipeline.model_info()
}

#[tauri::command]
fn get_pipeline_status(state: State<'_, AppState>) -> pipeline::PipelineStatus {
    state.pipeline.status()
}

#[tauri::command]
fn start_capture(
    app: AppHandle,
    source_id: String,
    confidence: f32,
    frames_per_second: u32,
    state: State<'_, AppState>,
) -> Result<pipeline::PipelineStatus, String> {
    state
        .pipeline
        .start(app, source_id, confidence, frames_per_second)
}

#[tauri::command]
fn stop_capture(state: State<'_, AppState>) -> Result<pipeline::PipelineStatus, String> {
    state.pipeline.stop()
}

fn resolve_model_directory(
    current_directory: PathBuf,
    resource_directory: PathBuf,
    data_directory: &std::path::Path,
) -> PathBuf {
    let mut candidates = Vec::new();

    if let Some(configured_directory) = std::env::var_os("POCKET_FAKER_MODEL_DIR") {
        candidates.push(PathBuf::from(configured_directory));
    }

    #[cfg(debug_assertions)]
    if let Some(project_directory) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(project_directory.to_path_buf());
    }

    candidates.push(data_directory.join("models"));
    candidates.push(current_directory.clone());
    if let Some(parent) = current_directory.parent() {
        candidates.push(parent.to_path_buf());
    }
    candidates.push(resource_directory);

    candidates
        .into_iter()
        .find(|directory| directory.join("yolo11x-minimap.onnx").is_file())
        .unwrap_or_else(|| data_directory.join("models"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .setup(|app| {
            let paths = storage::resolve_app_paths()?;
            let database = Database::new(paths.database_path.clone());
            database.initialize()?;
            let current_directory = std::env::current_dir()?;
            let resource_directory = app.path().resource_dir()?;
            let model_directory = resolve_model_directory(
                current_directory,
                resource_directory,
                &paths.data_directory,
            );
            let pipeline = Arc::new(pipeline::PipelineController::new(
                paths.database_path.clone(),
                paths.replay_directory.clone(),
                model_directory,
                paths.data_directory.join("model-cache"),
            ));

            app.manage(AppState {
                database_path: paths.database_path,
                replay_directory: paths.replay_directory,
                pipeline,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            list_sessions,
            create_session,
            finish_session,
            list_capture_sources,
            get_capture_permission_status,
            request_capture_permission,
            get_model_info,
            get_pipeline_status,
            start_capture,
            stop_capture
        ])
        .build(tauri::generate_context!())
        .expect("Pocket Faker could not start");

    application.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            let state = app_handle.state::<AppState>();
            let _ = state.pipeline.stop();
        }
    });
}
