import Foundation

// Stub implementation when FoundationModels is not available
// This file is compiled via Cargo build script when the build environment
// does not support Apple Intelligence (e.g. older Xcode/SDK).

private typealias ResponsePointer = UnsafeMutablePointer<AppleLLMResponse>
private typealias FrontmostAppPointer = UnsafeMutablePointer<FrontmostAppResponse>

@_cdecl("is_apple_intelligence_available")
public func isAppleIntelligenceAvailable() -> Int32 {
    return 0
}

@_cdecl("process_text_with_system_prompt_apple")
public func processTextWithSystemPrompt(
    _ systemPrompt: UnsafePointer<CChar>,
    _ userContent: UnsafePointer<CChar>,
    maxTokens: Int32
) -> UnsafeMutablePointer<AppleLLMResponse> {
    let responsePtr = ResponsePointer.allocate(capacity: 1)
    // Initialize with safe defaults
    responsePtr.initialize(to: AppleLLMResponse(response: nil, success: 0, error_message: nil))
    
    let msg = "Apple Intelligence is not available in this build (SDK requirement not met)."
    
    // Duplicate the string for the C caller to own
    responsePtr.pointee.error_message = strdup(msg)
    
    return responsePtr
}

@_cdecl("get_frontmost_app_context_apple")
public func getFrontmostAppContextApple() -> UnsafeMutablePointer<FrontmostAppResponse> {
    let responsePtr = FrontmostAppPointer.allocate(capacity: 1)
    responsePtr.initialize(
        to: FrontmostAppResponse(
            bundle_id: nil,
            localized_name: nil,
            success: 0,
            error_message: nil
        )
    )
    responsePtr.pointee.error_message = strdup(
        "Frontmost app lookup is not available in this build."
    )
    return responsePtr
}

@_cdecl("free_apple_llm_response")
public func freeAppleLLMResponse(_ response: UnsafeMutablePointer<AppleLLMResponse>?) {
    guard let response = response else { return }
    
    if let responseStr = response.pointee.response {
        free(UnsafeMutablePointer(mutating: responseStr))
    }
    
    if let errorStr = response.pointee.error_message {
        free(UnsafeMutablePointer(mutating: errorStr))
    }
    
    response.deallocate()
}

@_cdecl("free_frontmost_app_response")
public func freeFrontmostAppResponse(_ response: UnsafeMutablePointer<FrontmostAppResponse>?) {
    guard let response = response else { return }

    if let bundleId = response.pointee.bundle_id {
        free(UnsafeMutablePointer(mutating: bundleId))
    }

    if let localizedName = response.pointee.localized_name {
        free(UnsafeMutablePointer(mutating: localizedName))
    }

    if let errorStr = response.pointee.error_message {
        free(UnsafeMutablePointer(mutating: errorStr))
    }

    response.deallocate()
}
