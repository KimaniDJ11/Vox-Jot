import AppKit
import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

// A separate native stream, never the dictation recorder. Lifecycle state belongs
// to `control`; converters belong to `samples`. C callers run on Rust workers.
// No image output is registered or retained. Only audio leaves this bridge.
private func meetingJSON(_ value: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let text = String(data: data, encoding: .utf8) else { return nil }
    return strdup(text)
}

@available(macOS 15.0, *)
private final class MeetingStream: NSObject, SCStreamOutput, SCStreamDelegate {
    let control = DispatchQueue(label: "com.iriedinamik.voxjot.meeting.control")
    let samples = DispatchQueue(label: "com.iriedinamik.voxjot.meeting.samples", qos: .utility)
    let callback: MeetingAudioCallback
    let context: UInt64
    let processID: Int32
    let microphoneID: String
    let includeMicrophone: Bool
    // control queue only
    var stream: SCStream?
    var state = "starting"
    var failure: String?
    var cancelled = false
    var startPending = false
    var stopPending = false
    var sleepObserver: NSObjectProtocol?
    // Set before startCapture; read only thereafter by the sample queue.
    var origin = CMTime.zero
    // samples queue only
    var converters: [Int32: AVAudioConverter] = [:]

    init(context: UInt64, processID: Int32, microphoneID: String,
         includeMicrophone: Bool, callback: @escaping MeetingAudioCallback) {
        self.context = context
        self.processID = processID
        self.microphoneID = microphoneID
        self.includeMicrophone = includeMicrophone
        self.callback = callback
        super.init()
    }

    func begin() {
        control.async { [self] in
            guard CGPreflightScreenCaptureAccess() else {
                fail("Allow Vox Jot in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Vox Jot.")
                return
            }
            guard !includeMicrophone || AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
                fail("Microphone access is not granted. Use Allow recording permissions, then try again.")
                return
            }
            SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { [self] content, error in
                control.async { [self] in
                    guard !cancelled else { return }
                    guard let content, let display = content.displays.first else {
                        fail(error?.localizedDescription ?? "No display is available for system-audio capture.")
                        return
                    }
                    let filter: SCContentFilter
                    if processID > 0 {
                        guard let app = content.applications.first(where: { $0.processID == processID }) else {
                            fail("The selected application closed. Choose an audio source again.")
                            return
                        }
                        filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
                    } else {
                        filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
                    }
                    let configuration = SCStreamConfiguration()
                    configuration.capturesAudio = true
                    configuration.excludesCurrentProcessAudio = true
                    configuration.sampleRate = 48_000
                    configuration.channelCount = 1
                    configuration.captureMicrophone = includeMicrophone
                    if includeMicrophone && !microphoneID.isEmpty {
                        guard AVCaptureDevice(uniqueID: microphoneID) != nil else {
                            fail("The selected microphone disconnected. Choose a microphone again.")
                            return
                        }
                        configuration.microphoneCaptureDeviceID = microphoneID
                    }
                    // ScreenCaptureKit needs a content filter, but we do not add
                    // a video output. Keep the unused screen configuration tiny.
                    configuration.width = 2
                    configuration.height = 2
                    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                    configuration.queueDepth = 3
                    configuration.showsCursor = false
                    let capture = SCStream(filter: filter, configuration: configuration, delegate: self)
                    do {
                        try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: samples)
                        if includeMicrophone {
                            try capture.addStreamOutput(self, type: .microphone, sampleHandlerQueue: samples)
                        }
                        stream = capture
                        origin = CMClockGetTime(CMClockGetHostTimeClock())
                        startPending = true
                        capture.startCapture { [self] error in
                            control.async { [self] in
                                startPending = false
                                if let error {
                                    // An unsuccessful start has no running stream to
                                    // stop. Release outputs directly and drain any
                                    // callbacks instead of waiting on stopCapture.
                                    failure = error.localizedDescription
                                    cancelled = true
                                    if let observer = sleepObserver {
                                        NSWorkspace.shared.notificationCenter.removeObserver(observer)
                                        sleepObserver = nil
                                    }
                                    try? capture.removeStreamOutput(self, type: .audio)
                                    if includeMicrophone { try? capture.removeStreamOutput(self, type: .microphone) }
                                    stream = nil
                                    samples.async { [self] in control.async { [self] in state = "failed" } }
                                    return
                                }
                                if cancelled { stopOnControl(); return }
                                state = "recording"
                            }
                        }
                        sleepObserver = NSWorkspace.shared.notificationCenter.addObserver(
                            forName: NSWorkspace.willSleepNotification, object: nil, queue: nil
                        ) { [weak self] _ in
                            self?.control.async { [weak self] in
                                self?.fail("Recording stopped because the Mac is going to sleep. Captured audio is recoverable.")
                            }
                        }
                    } catch { fail(error.localizedDescription) }
                }
            }
        }
    }

    private func fail(_ message: String) {
        // Called only on control. Failure remains visible even after cleanup.
        if failure == nil { failure = message }
        stopOnControl()
    }

    private func stopOnControl() {
        cancelled = true
        if let observer = sleepObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            sleepObserver = nil
        }
        // Do not race stopCapture against an unresolved startCapture. Its
        // completion will observe cancellation and perform the actual stop.
        guard !startPending else { state = "stopping"; return }
        guard let capture = stream else {
            state = failure == nil ? "stopped" : "failed"
            return
        }
        guard !stopPending else { return }
        stopPending = true
        state = "stopping"
        capture.stopCapture { [self] error in
            // Drain all accepted sample callbacks before exposing terminal state.
            samples.async { [self] in
                control.async { [self] in
                    if let error, failure == nil { failure = error.localizedDescription }
                    stream = nil
                    stopPending = false
                    state = failure == nil ? "stopped" : "failed"
                }
            }
        }
    }

    func stop() { control.async { [self] in stopOnControl() } }

    func snapshot() -> [String: Any] {
        control.sync {
            if state == "recording", processID > 0,
               NSRunningApplication(processIdentifier: processID)?.isTerminated != false {
                fail("The selected source application closed. Captured audio was preserved.")
            }
            return ["state": state, "error": failure as Any? ?? NSNull()]
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        control.async { [self] in fail(error.localizedDescription) }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard buffer.isValid, type == .audio || type == .microphone else { return }
        let track: Int32 = type == .microphone ? 0 : 1
        do {
            try buffer.withAudioBufferList { list, _ in
                guard let description = buffer.formatDescription else {
                    throw NSError(domain: "VoxJotMeeting", code: 1)
                }
                let inputFormat = AVAudioFormat(cmAudioFormatDescription: description)
                guard let input = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: list.unsafePointer),
                      let outputFormat = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1) else {
                    throw NSError(domain: "VoxJotMeeting", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: "Unsupported audio buffer format."])
                }
                if converters[track]?.inputFormat != inputFormat {
                    converters[track] = AVAudioConverter(from: inputFormat, to: outputFormat)
                    converters[track]?.primeMethod = .none
                }
                guard let converter = converters[track],
                      let output = AVAudioPCMBuffer(pcmFormat: outputFormat,
                          frameCapacity: AVAudioFrameCount(ceil(Double(input.frameLength) * 16_000 / inputFormat.sampleRate)) + 64)
                else { throw NSError(domain: "VoxJotMeeting", code: 2,
                                      userInfo: [NSLocalizedDescriptionKey: "Unable to convert captured audio."]) }
                var supplied = false
                var conversionError: NSError?
                let result = converter.convert(to: output, error: &conversionError) { _, status in
                    if supplied { status.pointee = .noDataNow; return nil }
                    supplied = true
                    status.pointee = .haveData
                    return input
                }
                if result == .error {
                    throw conversionError ?? NSError(domain: "VoxJotMeeting", code: 3)
                }
                guard output.frameLength > 0, let data = output.floatChannelData?[0] else { return }
                let relative = CMTimeSubtract(buffer.presentationTimeStamp, origin)
                guard relative.isNumeric else { throw NSError(domain: "VoxJotMeeting", code: 4) }
                let timestamp = CMTimeConvertScale(relative, timescale: 1_000_000, method: .roundHalfAwayFromZero).value
                callback(context, track, data, Int32(output.frameLength), timestamp,
                         Int32(inputFormat.sampleRate.rounded()), Int32(inputFormat.channelCount))
            }
        } catch {
            control.async { [self] in fail("Audio capture failed: \(error.localizedDescription)") }
        }
    }
}

@_cdecl("meeting_capture_start_apple")
public func meetingCaptureStartApple(_ context: UInt64, _ processID: Int32,
    _ microphoneID: UnsafePointer<CChar>, _ includeMicrophone: Int32,
    _ callback: @escaping MeetingAudioCallback) -> UnsafeMutableRawPointer? {
    guard #available(macOS 15.0, *) else { return nil }
    let session = MeetingStream(context: context, processID: processID,
        microphoneID: String(cString: microphoneID), includeMicrophone: includeMicrophone != 0, callback: callback)
    session.begin()
    return Unmanaged.passRetained(session).toOpaque()
}

@_cdecl("meeting_capture_status_apple")
public func meetingCaptureStatusApple(_ handle: UnsafeMutableRawPointer) -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 15.0, *) else { return meetingJSON(["state": "failed", "error": "Meetings require macOS 15 or newer."]) }
    return meetingJSON(Unmanaged<MeetingStream>.fromOpaque(handle).takeUnretainedValue().snapshot())
}

@_cdecl("meeting_capture_stop_apple")
public func meetingCaptureStopApple(_ handle: UnsafeMutableRawPointer) {
    guard #available(macOS 15.0, *) else { return }
    Unmanaged<MeetingStream>.fromOpaque(handle).takeUnretainedValue().stop()
}

@_cdecl("meeting_capture_release_apple")
public func meetingCaptureReleaseApple(_ handle: UnsafeMutableRawPointer) {
    guard #available(macOS 15.0, *) else { return }
    let retained = Unmanaged<MeetingStream>.fromOpaque(handle)
    retained.takeUnretainedValue().stop()
    retained.release()
}

@_cdecl("meeting_capture_capabilities_apple")
public func meetingCaptureCapabilitiesApple() -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 15.0, *) else {
        return meetingJSON(["supported": false, "screen_permission": false,
                            "microphone_permission": false, "applications": [], "microphones": []])
    }
    let microphones = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external],
        mediaType: .audio, position: .unspecified).devices.map {
        ["id": $0.uniqueID, "name": $0.localizedName]
    }
    var applications: [[String: Any]] = []
    let collectApps = {
        applications = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier
        }.map { ["id": $0.processIdentifier, "name": $0.localizedName ?? "Application",
                 "bundle_id": $0.bundleIdentifier ?? ""] }
    }
    if Thread.isMainThread { collectApps() } else { DispatchQueue.main.sync(execute: collectApps) }
    return meetingJSON(["supported": true, "screen_permission": CGPreflightScreenCaptureAccess(),
        "microphone_permission": AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
        "applications": applications, "microphones": microphones])
}

@_cdecl("meeting_capture_request_permissions_apple")
public func meetingCaptureRequestPermissionsApple() {
    DispatchQueue.main.async {
        if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { _ in }
        }
    }
}

@_cdecl("meeting_capture_free_string_apple")
public func meetingCaptureFreeStringApple(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }

@_cdecl("meeting_capture_available_space_apple")
public func meetingCaptureAvailableSpaceApple(_ path: UnsafePointer<CChar>) -> Int64 {
    do {
        let values = try URL(fileURLWithPath: String(cString: path)).resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values.volumeAvailableCapacityForImportantUsage ?? -1
    } catch { return -1 }
}
