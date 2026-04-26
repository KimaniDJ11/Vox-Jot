#[cfg(target_os = "macos")]
mod platform {
    use log::{debug, warn};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;

    type AudioObjectID = u32;
    type AudioDeviceID = u32;
    type AudioObjectPropertySelector = u32;
    type AudioObjectPropertyScope = u32;
    type AudioObjectPropertyElement = u32;
    type OSStatus = i32;
    type Boolean = u8;

    const NO_ERR: OSStatus = 0;
    const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;
    const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: AudioObjectPropertyElement = 0;
    const DEFAULT_DUCKING_FACTOR: f32 = 0.5;

    const fn four_cc(bytes: &[u8; 4]) -> u32 {
        ((bytes[0] as u32) << 24)
            | ((bytes[1] as u32) << 16)
            | ((bytes[2] as u32) << 8)
            | bytes[3] as u32
    }

    const K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE: AudioObjectPropertySelector =
        four_cc(b"dOut");
    const K_AUDIO_DEVICE_PROPERTY_VOLUME_SCALAR: AudioObjectPropertySelector = four_cc(b"volm");
    const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: AudioObjectPropertyScope = four_cc(b"glob");
    const K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT: AudioObjectPropertyScope = four_cc(b"outp");

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct AudioObjectPropertyAddress {
        selector: AudioObjectPropertySelector,
        scope: AudioObjectPropertyScope,
        element: AudioObjectPropertyElement,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    unsafe extern "C" {
        fn AudioObjectHasProperty(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
        ) -> Boolean;

        fn AudioObjectGetPropertyData(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            io_data_size: *mut u32,
            out_data: *mut c_void,
        ) -> OSStatus;

        fn AudioObjectSetPropertyData(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            in_data_size: u32,
            in_data: *const c_void,
        ) -> OSStatus;
    }

    #[derive(Clone, Debug)]
    enum VolumeSnapshot {
        Master {
            device_id: AudioDeviceID,
            volume: f32,
        },
        Channels {
            device_id: AudioDeviceID,
            volumes: Vec<(AudioObjectPropertyElement, f32)>,
        },
    }

    #[derive(Clone, Default)]
    pub struct AudioDucker {
        snapshot: Arc<Mutex<Option<VolumeSnapshot>>>,
    }

    impl AudioDucker {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn duck_if_recording_async(&self, is_recording: Arc<AtomicBool>) {
            let snapshot = Arc::clone(&self.snapshot);

            thread::spawn(move || {
                if !is_recording.load(Ordering::SeqCst) {
                    return;
                }

                let mut guard = snapshot.lock().unwrap_or_else(|error| error.into_inner());
                if guard.is_some() {
                    return;
                }

                let Some(current_snapshot) = capture_volume_snapshot() else {
                    debug!("Audio ducking skipped because output volume could not be read");
                    return;
                };

                if !is_recording.load(Ordering::SeqCst) {
                    return;
                }

                match set_ducked_volume(&current_snapshot, DEFAULT_DUCKING_FACTOR) {
                    Ok(()) => {
                        *guard = Some(current_snapshot);
                        debug!("Audio ducking applied");
                    }
                    Err(error) => {
                        warn!("Failed to apply audio ducking: {error}");
                    }
                }
            });
        }

        pub fn restore_async(&self) {
            let snapshot = Arc::clone(&self.snapshot);

            thread::spawn(move || {
                let snapshot_to_restore = {
                    let mut guard = snapshot.lock().unwrap_or_else(|error| error.into_inner());
                    guard.take()
                };

                if let Some(snapshot_to_restore) = snapshot_to_restore {
                    match restore_volume_snapshot(&snapshot_to_restore) {
                        Ok(()) => debug!("Audio ducking restored"),
                        Err(error) => warn!("Failed to restore audio ducking: {error}"),
                    }
                }
            });
        }
    }

    fn capture_volume_snapshot() -> Option<VolumeSnapshot> {
        let device_id = default_output_device()?;

        if let Some(volume) = read_volume(device_id, K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN) {
            return Some(VolumeSnapshot::Master { device_id, volume });
        }

        let mut volumes = Vec::new();
        for element in 1..=2 {
            if let Some(volume) = read_volume(device_id, element) {
                volumes.push((element, volume));
            }
        }

        if volumes.is_empty() {
            None
        } else {
            Some(VolumeSnapshot::Channels { device_id, volumes })
        }
    }

    fn set_ducked_volume(snapshot: &VolumeSnapshot, factor: f32) -> Result<(), String> {
        match snapshot {
            VolumeSnapshot::Master { device_id, volume } => write_volume(
                *device_id,
                K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
                ducked(*volume, factor),
            ),
            VolumeSnapshot::Channels { device_id, volumes } => {
                let mut successes = 0usize;
                let mut last_error = None;

                for (element, volume) in volumes {
                    match write_volume(*device_id, *element, ducked(*volume, factor)) {
                        Ok(()) => successes += 1,
                        Err(error) => last_error = Some(error),
                    }
                }

                if successes > 0 {
                    Ok(())
                } else {
                    Err(last_error.unwrap_or_else(|| {
                        "No output channels accepted volume changes".to_string()
                    }))
                }
            }
        }
    }

    fn restore_volume_snapshot(snapshot: &VolumeSnapshot) -> Result<(), String> {
        match snapshot {
            VolumeSnapshot::Master { device_id, volume } => {
                write_volume(*device_id, K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN, *volume)
            }
            VolumeSnapshot::Channels { device_id, volumes } => {
                let mut successes = 0usize;
                let mut last_error = None;

                for (element, volume) in volumes {
                    match write_volume(*device_id, *element, *volume) {
                        Ok(()) => successes += 1,
                        Err(error) => last_error = Some(error),
                    }
                }

                if successes > 0 {
                    Ok(())
                } else {
                    Err(last_error.unwrap_or_else(|| {
                        "No output channels accepted volume restoration".to_string()
                    }))
                }
            }
        }
    }

    fn ducked(volume: f32, factor: f32) -> f32 {
        (volume * factor).clamp(0.0, 1.0)
    }

    fn default_output_device() -> Option<AudioDeviceID> {
        let address = AudioObjectPropertyAddress {
            selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mut device_id: AudioDeviceID = 0;
        let mut data_size = std::mem::size_of::<AudioDeviceID>() as u32;

        let status = unsafe {
            AudioObjectGetPropertyData(
                K_AUDIO_OBJECT_SYSTEM_OBJECT,
                &address,
                0,
                std::ptr::null(),
                &mut data_size,
                &mut device_id as *mut AudioDeviceID as *mut c_void,
            )
        };

        if status == NO_ERR && device_id != 0 {
            Some(device_id)
        } else {
            None
        }
    }

    fn read_volume(device_id: AudioDeviceID, element: AudioObjectPropertyElement) -> Option<f32> {
        let address = AudioObjectPropertyAddress {
            selector: K_AUDIO_DEVICE_PROPERTY_VOLUME_SCALAR,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT,
            element,
        };

        if unsafe { AudioObjectHasProperty(device_id, &address) } == 0 {
            return None;
        }

        let mut volume = 0.0f32;
        let mut data_size = std::mem::size_of::<f32>() as u32;

        let status = unsafe {
            AudioObjectGetPropertyData(
                device_id,
                &address,
                0,
                std::ptr::null(),
                &mut data_size,
                &mut volume as *mut f32 as *mut c_void,
            )
        };

        if status == NO_ERR && volume.is_finite() {
            Some(volume.clamp(0.0, 1.0))
        } else {
            None
        }
    }

    fn write_volume(
        device_id: AudioDeviceID,
        element: AudioObjectPropertyElement,
        volume: f32,
    ) -> Result<(), String> {
        let address = AudioObjectPropertyAddress {
            selector: K_AUDIO_DEVICE_PROPERTY_VOLUME_SCALAR,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT,
            element,
        };

        if unsafe { AudioObjectHasProperty(device_id, &address) } == 0 {
            return Err(format!(
                "Output device {device_id} does not expose volume element {element}"
            ));
        }

        let volume = volume.clamp(0.0, 1.0);
        let data_size = std::mem::size_of::<f32>() as u32;

        let status = unsafe {
            AudioObjectSetPropertyData(
                device_id,
                &address,
                0,
                std::ptr::null(),
                data_size,
                &volume as *const f32 as *const c_void,
            )
        };

        if status == NO_ERR {
            Ok(())
        } else {
            Err(format!(
                "CoreAudio rejected volume change for device {device_id}, element {element}: OSStatus {status}"
            ))
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[derive(Clone, Default)]
    pub struct AudioDucker;

    impl AudioDucker {
        pub fn new() -> Self {
            Self
        }

        pub fn duck_if_recording_async(&self, _is_recording: Arc<AtomicBool>) {}

        pub fn restore_async(&self) {}
    }
}

pub use platform::AudioDucker;
