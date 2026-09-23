use cpal::traits::{DeviceTrait, HostTrait};
use log::{debug, warn};
use rodio::OutputStreamBuilder;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

fn build_selected_or_default<D, I, EnumerationError, NameError, B, BuildError>(
    selected_device_name: &str,
    enumerate_devices: impl FnOnce() -> Result<I, EnumerationError>,
    mut get_device_name: impl FnMut(&D) -> Result<String, NameError>,
    from_device: impl FnOnce(D) -> Result<B, BuildError>,
    from_default_device: impl FnOnce() -> Result<B, BuildError>,
) -> Result<B, BuildError>
where
    I: IntoIterator<Item = D>,
    EnumerationError: std::fmt::Display,
    NameError: std::fmt::Display,
    BuildError: std::fmt::Display,
{
    let devices = match enumerate_devices() {
        Ok(devices) => devices,
        Err(error) => {
            warn!(
                "Could not enumerate output devices while looking for '{}'; using default: {}",
                selected_device_name, error
            );
            return from_default_device();
        }
    };

    for device in devices {
        match get_device_name(&device) {
            Ok(name) if name == selected_device_name => {
                return match from_device(device) {
                    Ok(stream) => Ok(stream),
                    Err(error) => {
                        warn!(
                            "Could not use selected output device '{}'; using default: {}",
                            selected_device_name, error
                        );
                        from_default_device()
                    }
                };
            }
            Ok(_) => {}
            Err(error) => {
                // A single stale/broken OS device entry must not prevent
                // playback through a later matching device or the default.
                warn!("Could not read output device name; skipping device: {error}");
            }
        }
    }

    warn!(
        "Output device '{}' not found, using default",
        selected_device_name
    );
    from_default_device()
}

fn open_default_output_stream() -> Result<rodio::OutputStream, rodio::StreamError> {
    OutputStreamBuilder::from_default_device()?.open_stream()
}

fn build_output_stream(
    selected_device: Option<String>,
) -> Result<rodio::OutputStream, Box<dyn std::error::Error>> {
    let stream = if let Some(device_name) = selected_device {
        if device_name == "Default" {
            debug!("Using default output device");
            open_default_output_stream()?
        } else {
            let host = crate::audio_toolkit::get_cpal_host();
            build_selected_or_default(
                &device_name,
                || host.output_devices(),
                |device| device.name(),
                |device| OutputStreamBuilder::from_device(device)?.open_stream(),
                open_default_output_stream,
            )?
        }
    } else {
        debug!("Using default output device");
        open_default_output_stream()?
    };

    Ok(stream)
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
    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let stream_handle = build_output_stream(selected_device)?;
    let mixer = stream_handle.mixer();

    let file = File::open(path)?;
    let buf_reader = BufReader::new(file);

    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let sink = rodio::play(mixer, buf_reader)?;
    sink.set_volume(volume);

    while !sink.empty() {
        if stop_flag.load(Ordering::Relaxed) {
            sink.stop();
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::build_selected_or_default;

    #[test]
    fn enumeration_failure_uses_default_device() {
        let result = build_selected_or_default(
            "Disconnected speakers",
            || Err::<Vec<&str>, _>("enumeration failed"),
            |device| Ok::<_, &str>((*device).to_string()),
            |_| Ok::<_, &str>("selected"),
            || Ok::<_, &str>("default"),
        );

        assert_eq!(result, Ok("default"));
    }

    #[test]
    fn default_device_failure_is_returned_after_enumeration_failure() {
        let result = build_selected_or_default(
            "Disconnected speakers",
            || Err::<Vec<&str>, _>("enumeration failed"),
            |device| Ok::<_, &str>((*device).to_string()),
            |_| Ok::<_, &str>("selected"),
            || Err::<&str, _>("default device failed"),
        );

        assert_eq!(result, Err("default device failed"));
    }

    #[test]
    fn unreadable_device_name_does_not_hide_later_match() {
        let devices = vec![(None, "stale"), (Some("Speakers"), "working")];
        let result = build_selected_or_default(
            "Speakers",
            || Ok::<_, &str>(devices),
            |device| device.0.map(str::to_string).ok_or("name failed"),
            |device| Ok::<_, &str>(device.1),
            || Ok::<_, &str>("default"),
        );

        assert_eq!(result, Ok("working"));
    }

    #[test]
    fn unusable_selected_device_uses_default_device() {
        let result = build_selected_or_default(
            "Speakers",
            || Ok::<_, &str>(vec!["Speakers"]),
            |device| Ok::<_, &str>((*device).to_string()),
            |_| Err::<&str, _>("selected device failed"),
            || Ok::<_, &str>("default"),
        );

        assert_eq!(result, Ok("default"));
    }

    #[test]
    fn default_failure_replaces_selected_device_failure() {
        let result = build_selected_or_default(
            "Speakers",
            || Ok::<_, &str>(vec!["Speakers"]),
            |device| Ok::<_, &str>((*device).to_string()),
            |_| Err::<&str, _>("selected device failed"),
            || Err::<&str, _>("default device failed"),
        );

        assert_eq!(result, Err("default device failed"));
    }
}
