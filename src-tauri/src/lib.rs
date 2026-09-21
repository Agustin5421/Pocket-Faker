mod storage;

use serde::Serialize;
use std::path::PathBuf;
use storage::{Database, SessionSummary};
use tauri::{Manager, State};

#[derive(Clone)]
struct AppState {
    database_path: PathBuf,
    replay_directory: PathBuf,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let paths = storage::resolve_app_paths()?;
            let database = Database::new(paths.database_path.clone());
            database.initialize()?;

            app.manage(AppState {
                database_path: paths.database_path,
                replay_directory: paths.replay_directory,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            list_sessions,
            create_session,
            finish_session
        ])
        .run(tauri::generate_context!())
        .expect("Pocket Faker could not start");
}
