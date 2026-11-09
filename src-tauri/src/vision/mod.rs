use serde::{Deserialize, Serialize};
use std::path::Path;

pub mod sam3;
pub mod tracking;
pub mod yolov8;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CharacterBackend {
    #[default]
    Current,
    Yolov8,
    Sam3,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct VisionConfig {
    pub version: u32,
    pub backend: CharacterBackend,
    pub python_path: String,
    pub checkpoint_path: String,
    pub prompt: String,
    pub target_label: String,
    pub device: String,
    pub max_fps: u32,
    pub tracking_enabled: bool,
}

impl Default for VisionConfig {
    fn default() -> Self {
        Self {
            version: 1,
            backend: CharacterBackend::Current,
            python_path: "python3".into(),
            checkpoint_path: String::new(),
            prompt: "red armored warrior with a large sword".into(),
            target_label: "Aatrox (objetivo solicitado)".into(),
            device: "mps".into(),
            max_fps: 1,
            tracking_enabled: true,
        }
    }
}

impl VisionConfig {
    pub fn validate(&self) -> Result<(), String> {
        let valid = self.version == 1
            && (1..=10).contains(&self.max_fps)
            && ["cpu", "mps"].contains(&self.device.as_str())
            && !self.prompt.trim().is_empty()
            && self.prompt.len() <= 512
            && !self.target_label.trim().is_empty()
            && self.target_label.len() <= 128
            && !self.python_path.trim().is_empty()
            && self.python_path.len() <= 4096
            && self.checkpoint_path.len() <= 4096;
        if valid {
            Ok(())
        } else {
            Err(
                "Configuración del personaje inválida (versión, dispositivo, frecuencia o prompt)"
                    .into(),
            )
        }
    }

    pub fn validate_checkpoint(&self) -> Result<(), String> {
        self.validate()?;
        if self.backend == CharacterBackend::Sam3 && !Path::new(&self.checkpoint_path).is_dir() {
            Err(
                "Seleccione un directorio local de checkpoint SAM 3 compatible con Transformers"
                    .into(),
            )
        } else {
            Ok(())
        }
    }
}

pub fn load_config(path: &Path) -> Result<VisionConfig, String> {
    let config = if path.exists() {
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        serde_json::from_slice::<VisionConfig>(&bytes).map_err(|error| error.to_string())?
    } else {
        VisionConfig::default()
    };
    config.validate()?;
    Ok(config)
}

pub fn save_config(path: &Path, config: &VisionConfig) -> Result<(), String> {
    config.validate()?;
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_preserve_current_detector_and_reject_invalid_settings() {
        let mut config = VisionConfig::default();
        assert_eq!(config.backend, CharacterBackend::Current);
        assert!(config.validate_checkpoint().is_ok());
        config.backend = CharacterBackend::Sam3;
        assert!(config.validate_checkpoint().is_err());
        config.max_fps = 0;
        assert!(config.validate().is_err());
        assert!(serde_json::from_str::<VisionConfig>(r#"{"backend":"yolo"}"#).is_err());
    }

    #[test]
    fn configuration_round_trip() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("vision.json");
        assert_eq!(
            load_config(&path).unwrap().backend,
            CharacterBackend::Current
        );
        let config = VisionConfig {
            backend: CharacterBackend::Sam3,
            ..Default::default()
        };
        save_config(&path, &config).unwrap();
        assert_eq!(load_config(&path).unwrap().backend, CharacterBackend::Sam3);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn accepts_yolov8_without_requiring_sam_checkpoint_and_preserves_legacy_config() {
        let config: VisionConfig = serde_json::from_str(r#"{"backend":"yolov8"}"#).unwrap();
        assert_eq!(config.backend, CharacterBackend::Yolov8);
        assert!(config.tracking_enabled);
        assert!(config.validate_checkpoint().is_ok());
        assert_eq!(serde_json::to_value(&config).unwrap()["backend"], "yolov8");
        let legacy: VisionConfig = serde_json::from_str(r#"{"version":1}"#).unwrap();
        assert_eq!(legacy.backend, CharacterBackend::Current);
        let disabled: VisionConfig =
            serde_json::from_str(r#"{"backend":"yolov8","trackingEnabled":false}"#).unwrap();
        assert!(!disabled.tracking_enabled);
    }
}
