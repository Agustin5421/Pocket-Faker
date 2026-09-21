use chrono::Utc;
use directories::{ProjectDirs, UserDirs};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{fs, path::PathBuf};
use thiserror::Error;
use uuid::Uuid;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("no se pudieron determinar los directorios locales de la aplicación")]
    MissingProjectDirectory,
    #[error("no se pudo preparar el almacenamiento local: {0}")]
    Io(#[from] std::io::Error),
    #[error("error de SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct AppPaths {
    pub database_path: PathBuf,
    pub replay_directory: PathBuf,
}

pub fn resolve_app_paths() -> Result<AppPaths, StorageError> {
    let project_dirs = ProjectDirs::from("com", "PocketFaker", "Pocket Faker")
        .ok_or(StorageError::MissingProjectDirectory)?;
    let data_directory = project_dirs.data_dir().to_path_buf();
    let replay_directory = UserDirs::new()
        .and_then(|directories| directories.video_dir().map(PathBuf::from))
        .unwrap_or_else(|| data_directory.clone())
        .join("Pocket Faker")
        .join("Replays");

    fs::create_dir_all(&data_directory)?;
    fs::create_dir_all(&replay_directory)?;

    Ok(AppPaths {
        database_path: data_directory.join("pocket-faker.sqlite3"),
        replay_directory,
    })
}

pub struct Database {
    path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub replay_path: String,
}

impl Database {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn initialize(&self) -> Result<(), StorageError> {
        let connection = self.open()?;
        connection.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('recording', 'completed', 'failed')),
                started_at TEXT NOT NULL,
                ended_at TEXT,
                replay_path TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                occurred_at_ms INTEGER NOT NULL,
                source TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prompts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS evaluations (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
                rating TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )?;

        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![SCHEMA_VERSION, Utc::now().to_rfc3339()],
        )?;

        Ok(())
    }

    pub fn health_check(&self) -> Result<bool, StorageError> {
        let connection = self.open()?;
        let result = connection.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))?;
        Ok(result == 1)
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, StorageError> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "SELECT id, title, status, started_at, ended_at, replay_path
             FROM sessions
             ORDER BY started_at DESC",
        )?;
        let sessions = statement
            .query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    status: row.get(2)?,
                    started_at: row.get(3)?,
                    ended_at: row.get(4)?,
                    replay_path: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(sessions)
    }

    pub fn create_session(
        &self,
        title: Option<String>,
        replay_root: &PathBuf,
    ) -> Result<SessionSummary, StorageError> {
        let id = Uuid::new_v4().to_string();
        let started_at = Utc::now().to_rfc3339();
        let replay_path = replay_root.join(&id);
        let title = title.unwrap_or_else(|| format!("Session {}", &id[..8]));

        fs::create_dir_all(&replay_path)?;
        let connection = self.open()?;
        connection.execute(
            "INSERT INTO sessions (id, title, status, started_at, replay_path)
             VALUES (?1, ?2, 'recording', ?3, ?4)",
            params![id, title, started_at, replay_path.display().to_string()],
        )?;

        Ok(SessionSummary {
            id,
            title,
            status: "recording".to_string(),
            started_at,
            ended_at: None,
            replay_path: replay_path.display().to_string(),
        })
    }

    pub fn finish_session(&self, session_id: &str) -> Result<(), StorageError> {
        let connection = self.open()?;
        connection.execute(
            "UPDATE sessions SET status = 'completed', ended_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), session_id],
        )?;
        Ok(())
    }

    fn open(&self) -> Result<Connection, StorageError> {
        let connection = Connection::open(&self.path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(connection)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_and_persists_session_metadata() {
        let sandbox = std::env::temp_dir().join(format!("pocket-faker-{}", Uuid::new_v4()));
        let database_path = sandbox.join("test.sqlite3");
        let replay_path = sandbox.join("replays");
        fs::create_dir_all(&replay_path).expect("test replay directory should be created");

        let database = Database::new(database_path);
        database.initialize().expect("database should initialize");
        let created = database
            .create_session(Some("Test session".to_string()), &replay_path)
            .expect("session should be created");
        database
            .finish_session(&created.id)
            .expect("session should finish");

        let sessions = database.list_sessions().expect("sessions should load");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "completed");
        assert!(sessions[0].ended_at.is_some());
        assert!(PathBuf::from(&sessions[0].replay_path).is_dir());

        fs::remove_dir_all(sandbox).expect("test files should be removed");
    }
}
