import AVFoundation
import Dispatch
import Foundation
import Speech

private typealias AppleSpeechPointer = UnsafeMutablePointer<AppleSpeechTranscriptionResponse>

private struct AppleSpeechSegment: Codable {
    let start_ms: UInt64
    let end_ms: UInt64
    let text: String
}

private struct AppleSpeechPayload: Codable {
    let text: String
    let segments: [AppleSpeechSegment]
}

private func duplicateCString(_ text: String) -> UnsafeMutablePointer<CChar>? {
    return text.withCString { basePointer in
        guard let duplicated = strdup(basePointer) else {
            return nil
        }
        return duplicated
    }
}

private func makeAppleSpeechResponse() -> AppleSpeechPointer {
    let responsePtr = AppleSpeechPointer.allocate(capacity: 1)
    responsePtr.initialize(
        to: AppleSpeechTranscriptionResponse(
            json_payload: nil,
            success: 0,
            error_message: nil
        )
    )
    return responsePtr
}

private func failAppleSpeechResponse(_ message: String) -> AppleSpeechPointer {
    let responsePtr = makeAppleSpeechResponse()
    responsePtr.pointee.error_message = duplicateCString(message)
    return responsePtr
}

@available(macOS 26.0, *)
private final class AppleSpeechResultBox: @unchecked Sendable {
    var payload: AppleSpeechPayload?
    var error: String?
}

@available(macOS 26.0, *)
private func localeForSpeech(_ identifier: String?) async throws -> Locale {
    let requested = (identifier?.isEmpty == false)
        ? Locale(identifier: identifier!)
        : Locale.current
    guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Apple SpeechAnalyzer does not support locale \(requested.identifier)."
            ]
        )
    }
    return supported
}

/// Make sure the on-device speech model assets for `transcriber`'s
/// locale are downloaded before we hand the transcriber to a
/// `SpeechAnalyzer`.
///
/// `SpeechTranscriber.isAvailable` only reports that the framework
/// runs on this device; it does not tell us whether the per-locale
/// model is installed. The authoritative source is `AssetInventory`:
///
/// 1. `AssetInventory.installedLocales` — which locales are ready.
/// 2. `AssetInventory.assetInstallationRequest(supporting:)` — returns
///    a request we can `await` to download the missing pack.
///
/// We download synchronously (the user explicitly asked us to use this
/// engine) but cap the wait so a user with no internet sees a clear
/// error instead of a hang.
@available(macOS 26.0, *)
private func ensureLocaleAssetsInstalled(
    transcriber: SpeechTranscriber,
    locale: Locale
) async throws {
    // `assetInstallationRequest(supporting:)` is the authoritative
    // "is anything missing for this transcriber?" API. It returns:
    //   - `nil`  → nothing to install; the analyzer will work.
    //   - `req`  → a download is required; await `downloadAndInstall`.
    // We previously relied on `SpeechTranscriber.isAvailable`, which
    // is a global check and lies for uninstalled locales — that's the
    // bug that caused the EXC_BREAKPOINT inside `preRunRecognition`.
    guard
        let request = try await AssetInventory.assetInstallationRequest(
            supporting: [transcriber]
        )
    else {
        return
    }

    // Download with a generous (5 min) cap so a stalled / offline
    // download surfaces as a normal error, not a forever-spin.
    try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
            try await request.downloadAndInstall()
        }
        group.addTask {
            try await Task.sleep(nanoseconds: 300_000_000_000)  // 5 minutes
            throw NSError(
                domain: "VoxJotAppleSpeech",
                code: 9,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "Timed out downloading the Apple Speech model for \(locale.identifier). Check your network and try again."
                ]
            )
        }
        // Whichever task finishes first wins; cancel the rest.
        try await group.next()
        group.cancelAll()
    }
}

@available(macOS 26.0, *)
private func makeMonoBuffer(
    samples: UnsafePointer<Float>,
    sampleCount: Int,
    sampleRate: Int32
) throws -> AVAudioPCMBuffer {
    guard sampleCount > 0 else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Audio input is empty."]
        )
    }
    guard sampleRate > 0 else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Audio sample rate is invalid."]
        )
    }
    guard
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Double(sampleRate),
            channels: 1,
            interleaved: false
        )
    else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "Failed to create Apple Speech audio format."]
        )
    }
    guard
        let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(sampleCount)
        )
    else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 5,
            userInfo: [NSLocalizedDescriptionKey: "Failed to create Apple Speech audio buffer."]
        )
    }
    buffer.frameLength = AVAudioFrameCount(sampleCount)
    guard let dst = buffer.floatChannelData?[0] else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "Apple Speech audio buffer has no channel data."]
        )
    }
    dst.update(from: samples, count: sampleCount)
    return buffer
}

@available(macOS 26.0, *)
private func audioFormatsMatch(_ lhs: AVAudioFormat, _ rhs: AVAudioFormat) -> Bool {
    abs(lhs.sampleRate - rhs.sampleRate) < 0.5
        && lhs.channelCount == rhs.channelCount
        && lhs.commonFormat == rhs.commonFormat
        && lhs.isInterleaved == rhs.isInterleaved
}

@available(macOS 26.0, *)
private func convertBuffer(
    _ inputBuffer: AVAudioPCMBuffer,
    to targetFormat: AVAudioFormat
) throws -> AVAudioPCMBuffer {
    if audioFormatsMatch(inputBuffer.format, targetFormat) {
        return inputBuffer
    }

    guard let converter = AVAudioConverter(from: inputBuffer.format, to: targetFormat) else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 11,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Failed to create Apple Speech audio converter from \(inputBuffer.format) to \(targetFormat)."
            ]
        )
    }

    let sampleRateRatio = targetFormat.sampleRate / inputBuffer.format.sampleRate
    let estimatedFrameCount = max(
        1,
        Int(ceil(Double(inputBuffer.frameLength) * sampleRateRatio)) + 1024
    )
    guard
        let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: targetFormat,
            frameCapacity: AVAudioFrameCount(estimatedFrameCount)
        )
    else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 12,
            userInfo: [NSLocalizedDescriptionKey: "Failed to allocate converted Apple Speech audio buffer."]
        )
    }

    var didProvideInput = false
    var conversionError: NSError?
    let status = converter.convert(to: outputBuffer, error: &conversionError) {
        _, outStatus in
        if didProvideInput {
            outStatus.pointee = .noDataNow
            return nil
        }
        didProvideInput = true
        outStatus.pointee = .haveData
        return inputBuffer
    }

    switch status {
    case .haveData, .inputRanDry, .endOfStream:
        return outputBuffer
    case .error:
        throw conversionError
            ?? NSError(
                domain: "VoxJotAppleSpeech",
                code: 13,
                userInfo: [NSLocalizedDescriptionKey: "Apple Speech audio conversion failed."]
            )
    @unknown default:
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 14,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Apple Speech audio conversion returned unexpected status \(status)."
            ]
        )
    }
}

@available(macOS 26.0, *)
private func transcribeAppleSpeechAsync(
    samples: UnsafePointer<Float>,
    sampleCount: Int,
    sampleRate: Int32,
    localeIdentifier: String?,
    progressive: Bool
) async throws -> AppleSpeechPayload {
    let locale = try await localeForSpeech(localeIdentifier)
    let preset: SpeechTranscriber.Preset = progressive
        ? .timeIndexedProgressiveTranscription
        : .timeIndexedTranscriptionWithAlternatives
    let transcriber = SpeechTranscriber(locale: locale, preset: preset)
    guard SpeechTranscriber.isAvailable else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 7,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Apple SpeechAnalyzer is not available for \(locale.identifier) on this device."
            ]
        )
    }

    // Without this, the analyzer can crash with EXC_BREAKPOINT inside
    // `SpeechRecognizerWorker.preRunRecognition()` whenever the user's
    // chosen locale doesn't have its language pack installed.
    try await ensureLocaleAssetsInstalled(transcriber: transcriber, locale: locale)

    guard
        let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber]
        )
    else {
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 15,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Apple Speech has no compatible audio format for \(locale.identifier). Install the speech model and try again."
            ]
        )
    }

    let sourceBuffer = try makeMonoBuffer(
        samples: samples,
        sampleCount: sampleCount,
        sampleRate: sampleRate
    )
    let buffer = try convertBuffer(sourceBuffer, to: analyzerFormat)
    let (inputSequence, inputBuilder) = AsyncStream.makeStream(of: AnalyzerInput.self)
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.prepareToAnalyze(in: buffer.format, withProgressReadyHandler: nil)

    final class Collector: @unchecked Sendable {
        var fragments: [String] = []
    }
    let collector = Collector()
    let resultTask = Task {
        for try await result in transcriber.results {
            let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                collector.fragments.append(text)
            }
        }
    }

    inputBuilder.yield(AnalyzerInput(buffer: buffer))
    inputBuilder.finish()

    // Even after the asset preflight, certain edge cases (e.g. an
    // asset partially purged by the OS, a brand-new locale without a
    // recognizer module) can still throw inside `analyzeSequence`. We
    // catch and rethrow with a friendlier message instead of letting
    // the raw NSError propagate up.
    do {
        let lastSampleTime = try await analyzer.analyzeSequence(inputSequence)
        if let lastSampleTime {
            try await analyzer.finalizeAndFinish(through: lastSampleTime)
        } else {
            await analyzer.cancelAndFinishNow()
        }
    } catch {
        await analyzer.cancelAndFinishNow()
        resultTask.cancel()
        throw NSError(
            domain: "VoxJotAppleSpeech",
            code: 10,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Apple Speech failed for \(locale.identifier): \(error.localizedDescription)"
            ]
        )
    }
    try await resultTask.value

    let text = collector.fragments.joined(separator: " ")
    let durationMs = UInt64((Double(sampleCount) / Double(sampleRate)) * 1000.0)
    let segments = text.isEmpty
        ? []
        : [AppleSpeechSegment(start_ms: 0, end_ms: durationMs, text: text)]
    return AppleSpeechPayload(text: text, segments: segments)
}

@_cdecl("is_apple_speech_analyzer_available")
public func isAppleSpeechAnalyzerAvailable() -> Int32 {
    guard #available(macOS 26.0, *) else {
        return 0
    }
    return SpeechTranscriber.isAvailable ? 1 : 0
}

/// Returns 1 if the given locale's speech model is ready to use right
/// now (no download required), 0 otherwise. The locale must have no
/// pending `AssetInventory` installation request and must expose a
/// SpeechAnalyzer-compatible audio format.
///
/// The Rust side uses this to surface a "Downloading speech model…"
/// log line before the first transcription instead of having that
/// transcription appear to silently hang while the asset downloads.
///
/// Pass a NULL or empty locale to check `Locale.current`.
@_cdecl("is_apple_speech_locale_installed")
public func isAppleSpeechLocaleInstalled(
    _ localeIdentifier: UnsafePointer<CChar>?
) -> Int32 {
    guard #available(macOS 26.0, *) else {
        return 0
    }
    let identifier = localeIdentifier.map { String(cString: $0) }
    let semaphore = DispatchSemaphore(value: 0)
    var installed: Int32 = 0
    Task.detached(priority: .userInitiated) {
        defer { semaphore.signal() }
        let requested = (identifier?.isEmpty == false)
            ? Locale(identifier: identifier!)
            : Locale.current
        guard let resolved = await SpeechTranscriber.supportedLocale(equivalentTo: requested)
        else {
            installed = 0
            return
        }
        let probe = SpeechTranscriber(
            locale: resolved,
            preset: .timeIndexedTranscriptionWithAlternatives
        )
        do {
            let request = try await AssetInventory.assetInstallationRequest(
                supporting: [probe]
            )
            if request != nil {
                installed = 0
                return
            }
            let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [probe])
            installed = (format == nil) ? 0 : 1
        } catch {
            installed = 0
        }
    }
    semaphore.wait()
    return installed
}

@_cdecl("transcribe_with_apple_speech")
public func transcribeWithAppleSpeech(
    _ samples: UnsafePointer<Float>?,
    sampleCount: Int32,
    sampleRate: Int32,
    localeIdentifier: UnsafePointer<CChar>?,
    progressive: Int32
) -> UnsafeMutablePointer<AppleSpeechTranscriptionResponse> {
    guard #available(macOS 26.0, *) else {
        return failAppleSpeechResponse("Apple SpeechAnalyzer requires macOS 26 or newer.")
    }
    guard let samples = samples else {
        return failAppleSpeechResponse("Apple SpeechAnalyzer received null audio samples.")
    }

    let locale = localeIdentifier.map { String(cString: $0) }
    let responsePtr = makeAppleSpeechResponse()
    let semaphore = DispatchSemaphore(value: 0)
    let box = AppleSpeechResultBox()

    Task.detached(priority: .userInitiated) {
        defer { semaphore.signal() }
        do {
            box.payload = try await transcribeAppleSpeechAsync(
                samples: samples,
                sampleCount: Int(sampleCount),
                sampleRate: sampleRate,
                localeIdentifier: locale,
                progressive: progressive == 1
            )
        } catch {
            box.error = error.localizedDescription
        }
    }

    semaphore.wait()

    if let payload = box.payload {
        do {
            let data = try JSONEncoder().encode(payload)
            let json = String(data: data, encoding: .utf8) ?? "{\"text\":\"\",\"segments\":[]}"
            responsePtr.pointee.json_payload = duplicateCString(json)
            responsePtr.pointee.success = 1
        } catch {
            responsePtr.pointee.error_message = duplicateCString(error.localizedDescription)
        }
    } else {
        responsePtr.pointee.error_message = duplicateCString(box.error ?? "Unknown Apple Speech error")
    }

    return responsePtr
}

@_cdecl("free_apple_speech_transcription_response")
public func freeAppleSpeechTranscriptionResponse(
    _ response: UnsafeMutablePointer<AppleSpeechTranscriptionResponse>?
) {
    guard let response = response else { return }

    if let payload = response.pointee.json_payload {
        free(UnsafeMutablePointer(mutating: payload))
    }

    if let errorStr = response.pointee.error_message {
        free(UnsafeMutablePointer(mutating: errorStr))
    }

    response.deallocate()
}
