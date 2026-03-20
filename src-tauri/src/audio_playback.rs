use cpal::traits::{DeviceTrait, HostTrait};
use log::{debug, warn};
use rodio::OutputStreamBuilder;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

fn build_output_stream(
    selected_device: Option<String>,
) -> Result<rodio::OutputStream, Box<dyn std::error::Error>> {
    let stream_builder = if let Some(device_name) = selected_device {
        if device_name == "Default" {
            debug!("Using default output device");
            OutputStreamBuilder::from_default_device()?
        } else {
            let host = crate::audio_toolkit::get_cpal_host();
            let devices = host.output_devices()?;

            let mut found_device = None;
            for device in devices {
                if device.name()? == device_name {
                    found_device = Some(device);
                    break;
                }
            }

            match found_device {
                Some(device) => OutputStreamBuilder::from_device(device)?,
                None => {
                    warn!("Output device '{}' not found, using default", device_name);
                    OutputStreamBuilder::from_default_device()?
                }
            }
        }
    } else {
        debug!("Using default output device");
        OutputStreamBuilder::from_default_device()?
    };

    Ok(stream_builder.open_stream()?)
}

pub fn play_audio_file_blocking(
    path: &Path,
    selected_device: Option<String>,
    volume: f32,
) -> Result<(), Box<dyn std::error::Error>> {
    let stop_flag = AtomicBool::new(false);
    play_audio_file_with_stop(path, selected_device, volume, &stop_flag)
}

pub fn play_audio_file_with_stop(
    path: &Path,
    selected_device: Option<String>,
    volume: f32,
    stop_flag: &AtomicBool,
) -> Result<(), Box<dyn std::error::Error>> {
    let stream_handle = build_output_stream(selected_device)?;
    let mixer = stream_handle.mixer();

    let file = File::open(path)?;
    let buf_reader = BufReader::new(file);
    let sink = rodio::play(mixer, buf_reader)?;
    sink.set_volume(volume);

    while !sink.empty() {
        if stop_flag.load(Ordering::Relaxed) {
            sink.stop();
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    Ok(())
}
