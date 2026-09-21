use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, RgbaImage};
use serde::Serialize;
use std::{
    io::Cursor,
    sync::atomic::{AtomicBool, Ordering},
};
#[cfg(not(target_os = "macos"))]
use xcap::{Monitor, Window};

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::CaptureTarget;

static PERMISSION_REQUESTED_THIS_LAUNCH: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePermissionStatus {
    pub supported: bool,
    pub granted: bool,
    pub requested_this_launch: bool,
    pub requires_restart: bool,
}

pub fn capture_permission_status() -> CapturePermissionStatus {
    #[cfg(target_os = "macos")]
    let granted = core_graphics::access::ScreenCaptureAccess.preflight();
    #[cfg(not(target_os = "macos"))]
    let granted = true;

    let requested_this_launch = PERMISSION_REQUESTED_THIS_LAUNCH.load(Ordering::Relaxed);
    CapturePermissionStatus {
        supported: cfg!(target_os = "macos"),
        granted,
        requested_this_launch,
        requires_restart: cfg!(target_os = "macos") && requested_this_launch && !granted,
    }
}

pub fn request_capture_permission() -> CapturePermissionStatus {
    #[cfg(target_os = "macos")]
    {
        let access = core_graphics::access::ScreenCaptureAccess;
        if !access.preflight() && !PERMISSION_REQUESTED_THIS_LAUNCH.swap(true, Ordering::Relaxed) {
            let _ = access.request();
        }
    }

    capture_permission_status()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub id: String,
    pub source_type: String,
    pub app_name: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub is_league: bool,
}

pub fn list_sources() -> Result<Vec<CaptureSource>, String> {
    #[cfg(target_os = "macos")]
    let mut sources = macos::list_sources()?;

    #[cfg(not(target_os = "macos"))]
    let mut sources = Window::all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|window| capture_source(&window).ok())
        .filter(|source| source.width >= 320 && source.height >= 240)
        .collect::<Vec<_>>();

    #[cfg(not(target_os = "macos"))]
    let displays = Monitor::all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|monitor| monitor_source(&monitor).ok());
    #[cfg(not(target_os = "macos"))]
    sources.extend(displays);

    sources.sort_by(|left, right| {
        right
            .is_league
            .cmp(&left.is_league)
            .then_with(|| left.source_type.cmp(&right.source_type))
            .then_with(|| left.app_name.cmp(&right.app_name))
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(sources)
}

#[cfg(not(target_os = "macos"))]
pub enum CaptureTarget {
    Window(Window),
    Display(Monitor),
}

#[cfg(not(target_os = "macos"))]
impl CaptureTarget {
    pub fn capture_image(&self) -> Result<RgbaImage, String> {
        match self {
            Self::Window(window) => window.capture_image().map_err(|error| error.to_string()),
            Self::Display(monitor) => monitor.capture_image().map_err(|error| error.to_string()),
        }
    }
}

#[cfg(target_os = "macos")]
pub fn find_target(source_id: &str, frames_per_second: u32) -> Result<CaptureTarget, String> {
    macos::CaptureTarget::new(source_id, frames_per_second)
}

#[cfg(not(target_os = "macos"))]
pub fn find_target(source_id: &str, _frames_per_second: u32) -> Result<CaptureTarget, String> {
    let (source_type, raw_id) = source_id
        .split_once(':')
        .ok_or_else(|| "invalid capture source identifier".to_string())?;
    let id = raw_id
        .parse::<u32>()
        .map_err(|_| "invalid capture source identifier".to_string())?;

    match source_type {
        "window" => Window::all()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|window| window.id().ok() == Some(id))
            .map(CaptureTarget::Window)
            .ok_or_else(|| "the selected window is no longer available".to_string()),
        "display" => Monitor::all()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|monitor| monitor.id().ok() == Some(id))
            .map(CaptureTarget::Display)
            .ok_or_else(|| "the selected display is no longer available".to_string()),
        _ => Err("unsupported capture source type".to_string()),
    }
}

pub fn crop_minimap(frame: &RgbaImage) -> RgbaImage {
    let crop_size = ((frame.height() as f32 * 0.30).round() as u32)
        .min(frame.width())
        .max(1);
    let x = frame.width().saturating_sub(crop_size);
    let y = frame.height().saturating_sub(crop_size);
    image::imageops::crop_imm(frame, x, y, crop_size, crop_size).to_image()
}

pub fn encode_jpeg(image: &RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode_image(&DynamicImage::ImageRgba8(image.clone()))
        .map_err(|error| error.to_string())?;
    Ok(bytes.into_inner())
}

pub fn encode_preview_data_url(image: &RgbaImage, maximum_width: u32) -> Result<String, String> {
    let preview = if image.width() > maximum_width {
        let height = ((maximum_width as f32 / image.width() as f32) * image.height() as f32)
            .round()
            .max(1.0) as u32;
        image::imageops::resize(image, maximum_width, height, FilterType::Triangle)
    } else {
        image.clone()
    };
    let bytes = encode_jpeg(&preview, 72)?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(not(target_os = "macos"))]
fn capture_source(window: &Window) -> Result<CaptureSource, String> {
    let app_name = window.app_name().map_err(|error| error.to_string())?;
    let title = window.title().map_err(|error| error.to_string())?;
    let league_name = format!("{app_name} {title}").to_lowercase();

    Ok(CaptureSource {
        id: format!("window:{}", window.id().map_err(|error| error.to_string())?),
        source_type: "window".to_string(),
        app_name,
        title,
        width: window.width().map_err(|error| error.to_string())?,
        height: window.height().map_err(|error| error.to_string())?,
        is_league: league_name.contains("league of legends"),
    })
}

#[cfg(not(target_os = "macos"))]
fn monitor_source(monitor: &Monitor) -> Result<CaptureSource, String> {
    let name = monitor.name().map_err(|error| error.to_string())?;
    Ok(CaptureSource {
        id: format!(
            "display:{}",
            monitor.id().map_err(|error| error.to_string())?
        ),
        source_type: "display".to_string(),
        app_name: "Display".to_string(),
        title: name,
        width: monitor.width().map_err(|error| error.to_string())?,
        height: monitor.height().map_err(|error| error.to_string())?,
        is_league: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crops_square_minimap_from_bottom_right() {
        let frame = RgbaImage::new(1920, 1080);
        let crop = crop_minimap(&frame);
        assert_eq!(crop.dimensions(), (324, 324));
    }

    #[test]
    #[ignore = "requires a desktop session"]
    fn discovers_desktop_windows() {
        let sources = list_sources().expect("window discovery should succeed");
        for source in &sources {
            println!(
                "{} | {} | {}x{} | league={}",
                source.app_name, source.title, source.width, source.height, source.is_league
            );
        }
        assert!(
            !sources.is_empty(),
            "at least one capture source should exist"
        );
    }

    #[test]
    #[ignore = "requires League of Legends to be running and screen capture permission"]
    fn captures_league_window() {
        let source = list_sources()
            .expect("window discovery should succeed")
            .into_iter()
            .find(|source| source.is_league)
            .expect("League of Legends should be visible");
        let target = find_target(&source.id, 5).expect("League source should still exist");
        for _ in 0..6 {
            let frame = target
                .capture_image()
                .expect("League stream should keep producing frames");
            assert!(frame.width() >= source.width);
            assert!(frame.height() >= source.height);
        }
    }
}
