import Foundation

private typealias AppleSpeechPointer = UnsafeMutablePointer<AppleSpeechTranscriptionResponse>

@_cdecl("is_apple_speech_analyzer_available")
public func isAppleSpeechAnalyzerAvailable() -> Int32 {
    return 0
}

@_cdecl("is_apple_speech_locale_installed")
public func isAppleSpeechLocaleInstalled(
    _ localeIdentifier: UnsafePointer<CChar>?
) -> Int32 {
    return 0
}

@_cdecl("transcribe_with_apple_speech")
public func transcribeWithAppleSpeech(
    _ samples: UnsafePointer<Float>?,
    sampleCount: Int32,
    sampleRate: Int32,
    localeIdentifier: UnsafePointer<CChar>?,
    progressive: Int32
) -> UnsafeMutablePointer<AppleSpeechTranscriptionResponse> {
    let responsePtr = AppleSpeechPointer.allocate(capacity: 1)
    responsePtr.initialize(
        to: AppleSpeechTranscriptionResponse(
            json_payload: nil,
            success: 0,
            error_message: nil
        )
    )
    responsePtr.pointee.error_message = strdup(
        "Apple SpeechAnalyzer is not available in this build (SDK requirement not met)."
    )
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
