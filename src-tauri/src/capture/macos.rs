#![allow(clippy::useless_transmute)]

use super::CaptureSource;
use cidre::sc::StreamOutput;
use cidre::{arc, cm, cv, define_obj_type, dispatch, ns, objc, sc};
use futures::executor::block_on;
use image::RgbaImage;
use std::{
    sync::{Arc, Condvar, Mutex, Once},
    time::Duration,
};

const FRAME_TIMEOUT: Duration = Duration::from_secs(5);
static CORE_GRAPHICS_INITIALIZED: Once = Once::new();

fn initialize_core_graphics() {
    CORE_GRAPHICS_INITIALIZED.call_once(|| {
        let _ = core_graphics::display::CGDisplay::main();
    });
}

#[derive(Default)]
struct LatestFrame {
    image: Option<RgbaImage>,
}

struct CaptureOutputInner {
    latest: Arc<(Mutex<LatestFrame>, Condvar)>,
}

define_obj_type!(
    CaptureOutput + sc::StreamOutputImpl,
    CaptureOutputInner,
    CAPTURE_OUTPUT
);

impl sc::stream::Output for CaptureOutput {}

#[objc::add_methods]
impl sc::StreamOutputImpl for CaptureOutput {
    extern "C" fn impl_stream_did_output_sample_buf(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _stream: &sc::Stream,
        sample_buffer: &mut cm::SampleBuf,
        output_type: sc::OutputType,
    ) {
        if output_type != sc::OutputType::Screen {
            return;
        }
        let Some(pixel_buffer) = sample_buffer.image_buf_mut() else {
            return;
        };
        let Some(image) = copy_bgra_frame(pixel_buffer) else {
            return;
        };

        let (frame, ready) = &*self.inner().latest;
        if let Ok(mut frame) = frame.lock() {
            frame.image = Some(image);
            ready.notify_one();
        }
    }
}

fn copy_bgra_frame(pixel_buffer: &mut cv::PixelBuf) -> Option<RgbaImage> {
    let flags = cv::pixel_buffer::LockFlags::READ_ONLY;
    if unsafe { pixel_buffer.lock_base_addr(flags).result() }.is_err() {
        return None;
    }

    let result = (|| {
        let width = pixel_buffer.width();
        let height = pixel_buffer.height();
        let bytes_per_row = pixel_buffer.bytes_per_row();
        if width == 0 || height == 0 || bytes_per_row < width.checked_mul(4)? {
            return None;
        }
        let source_ptr = unsafe { pixel_buffer.base_address() }.cast::<u8>();
        if source_ptr.is_null() {
            return None;
        }
        let source =
            unsafe { std::slice::from_raw_parts(source_ptr, bytes_per_row.checked_mul(height)?) };
        let mut rgba = Vec::with_capacity(width.checked_mul(height)?.checked_mul(4)?);
        for row in source.chunks(bytes_per_row).take(height) {
            for pixel in row[..width * 4].chunks_exact(4) {
                rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
            }
        }
        RgbaImage::from_raw(width as u32, height as u32, rgba)
    })();

    let _ = unsafe { pixel_buffer.unlock_lock_base_addr(flags) };
    result
}

pub struct CaptureTarget {
    stream: arc::R<sc::Stream>,
    _output: arc::R<CaptureOutput>,
    latest: Arc<(Mutex<LatestFrame>, Condvar)>,
}

impl CaptureTarget {
    pub fn new(source_id: &str, frames_per_second: u32) -> Result<Self, String> {
        initialize_core_graphics();
        let (source_type, raw_id) = source_id
            .split_once(':')
            .ok_or_else(|| "invalid capture source identifier".to_string())?;
        let id = raw_id
            .parse::<u32>()
            .map_err(|_| "invalid capture source identifier".to_string())?;
        let content = shareable_content()?;

        let filter = match source_type {
            "window" => {
                let windows = content.windows();
                let window = windows
                    .iter()
                    .find(|window| window.id() == id)
                    .ok_or_else(|| "the selected window is no longer available".to_string())?;
                sc::ContentFilter::with_desktop_independent_window(window)
            }
            "display" => {
                let displays = content.displays();
                let display = displays
                    .iter()
                    .find(|display| display.display_id().0 == id)
                    .ok_or_else(|| "the selected display is no longer available".to_string())?;
                let excluded_windows = ns::Array::<sc::Window>::new();
                sc::ContentFilter::with_display_excluding_windows(display, &excluded_windows)
            }
            _ => return Err("unsupported capture source type".to_string()),
        };

        let info = sc::ShareableContent::info_for_filter(&filter);
        let content_rect = info.content_rect();
        let scale = f64::from(info.point_pixel_scale().max(1.0));
        let width = (content_rect.size.width * scale).round().max(1.0) as usize;
        let height = (content_rect.size.height * scale).round().max(1.0) as usize;
        let mut config = sc::StreamCfg::new();
        config.set_width(width);
        config.set_height(height);
        config.set_pixel_format(cv::PixelFormat::_32_BGRA);
        config.set_minimum_frame_interval(cm::Time::new(
            1,
            i32::try_from(frames_per_second.clamp(1, 60)).unwrap_or(2),
        ));
        config.set_queue_depth(2);
        config.set_shows_cursor(false);

        let latest = Arc::new((Mutex::new(LatestFrame::default()), Condvar::new()));
        let output = CaptureOutput::with(CaptureOutputInner {
            latest: latest.clone(),
        });
        let queue = dispatch::Queue::serial_with_ar_pool();
        let stream = sc::Stream::new(&filter, &config);
        stream
            .add_stream_output(output.as_ref(), sc::OutputType::Screen, Some(&queue))
            .map_err(|error| error.to_string())?;
        block_on(stream.start()).map_err(|error| error.to_string())?;

        Ok(Self {
            stream,
            _output: output,
            latest,
        })
    }

    pub fn capture_image(&self) -> Result<RgbaImage, String> {
        let (frame, ready) = &*self.latest;
        let frame = frame.lock().map_err(|error| error.to_string())?;
        let (mut frame, timeout) = ready
            .wait_timeout_while(frame, FRAME_TIMEOUT, |frame| frame.image.is_none())
            .map_err(|error| error.to_string())?;
        if timeout.timed_out() && frame.image.is_none() {
            return Err(
                "ScreenCaptureKit did not produce a frame within 5 seconds. Check that the source still exists and Screen Recording permission is enabled."
                    .to_string(),
            );
        }
        frame
            .image
            .take()
            .ok_or_else(|| "ScreenCaptureKit returned an empty frame".to_string())
    }
}

impl Drop for CaptureTarget {
    fn drop(&mut self) {
        let _ = block_on(self.stream.stop());
    }
}

pub fn list_sources() -> Result<Vec<CaptureSource>, String> {
    initialize_core_graphics();
    let content = shareable_content()?;
    let mut sources = content
        .windows()
        .iter()
        .filter(|window| {
            let frame = window.frame();
            frame.size.width >= 320.0 && frame.size.height >= 240.0
        })
        .filter_map(|window| {
            let app_name = window
                .owning_app()
                .map(|application| application.app_name().to_string())
                .unwrap_or_else(|| "Application".to_string());
            let title = window
                .title()
                .map(|title| title.to_string())
                .unwrap_or_default();
            if app_name.is_empty() && title.is_empty() {
                return None;
            }
            let frame = window.frame();
            let league_name = format!("{app_name} {title}").to_lowercase();
            Some(CaptureSource {
                id: format!("window:{}", window.id()),
                source_type: "window".to_string(),
                app_name,
                title,
                width: frame.size.width.round().max(1.0) as u32,
                height: frame.size.height.round().max(1.0) as u32,
                is_league: league_name.contains("league of legends"),
            })
        })
        .collect::<Vec<_>>();

    sources.extend(content.displays().iter().map(|display| CaptureSource {
        id: format!("display:{}", display.display_id().0),
        source_type: "display".to_string(),
        app_name: "Display".to_string(),
        title: format!("Display #{}", display.display_id().0),
        width: display.width().max(1) as u32,
        height: display.height().max(1) as u32,
        is_league: false,
    }));

    Ok(sources)
}

fn shareable_content() -> Result<arc::R<sc::ShareableContent>, String> {
    block_on(sc::ShareableContent::current()).map_err(|error| error.to_string())
}
