import AppKit
import CoreGraphics
import Dispatch
import Foundation
import Vision
#if canImport(ScreenCaptureKit)
import ScreenCaptureKit
#endif

private let screenContextMaxCaptureDimension = 2200
private let screenContextCaptureLock = NSLock()

private typealias ScreenContextPointer = UnsafeMutablePointer<ScreenContextCaptureResponse>

private func duplicateScreenCString(_ text: String) -> UnsafeMutablePointer<CChar>? {
    return text.withCString { basePointer in
        guard let duplicated = strdup(basePointer) else {
            return nil
        }
        return duplicated
    }
}

private struct OcrSnippet: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct ScreenContextPayload: Codable {
    let display_id: UInt32
    let captured_at_ms: Int64
    let snippets: [OcrSnippet]
}

private func words(in text: String) -> [Substring] {
    return text.split(whereSeparator: { $0.isWhitespace || $0.isNewline })
}

private func clipSnippets(_ snippets: [OcrSnippet], maxWords: Int) -> [OcrSnippet] {
    guard maxWords > 0 else { return snippets }

    var clipped: [OcrSnippet] = []
    var wordBudget = maxWords

    for snippet in snippets {
        let tokens = words(in: snippet.text)
        guard !tokens.isEmpty else { continue }
        if wordBudget <= 0 { break }

        if tokens.count <= wordBudget {
            clipped.append(snippet)
            wordBudget -= tokens.count
            continue
        }

        let truncated = tokens.prefix(wordBudget).joined(separator: " ")
        guard !truncated.isEmpty else { break }
        clipped.append(
            OcrSnippet(
                text: truncated,
                confidence: snippet.confidence,
                x: snippet.x,
                y: snippet.y,
                width: snippet.width,
                height: snippet.height
            )
        )
        break
    }

    return clipped
}

private func encodePayload(_ payload: ScreenContextPayload) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []
    guard let data = try? encoder.encode(payload),
        let json = String(data: data, encoding: .utf8)
    else {
        return #"{"display_id":0,"captured_at_ms":0,"snippets":[]}"#
    }
    return json
}

private func activeDisplayIdentifier() -> UInt32? {
    let mouseLocation = NSEvent.mouseLocation
    for screen in NSScreen.screens {
        if NSMouseInRect(mouseLocation, screen.frame, false),
            let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        {
            return number.uint32Value
        }
    }

    guard
        let screen = NSScreen.main ?? NSScreen.screens.first,
        let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    else {
        return nil
    }

    return number.uint32Value
}

private func screenSize(for displayId: UInt32) -> CGSize? {
    for screen in NSScreen.screens {
        guard
            let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
            number.uint32Value == displayId
        else {
            continue
        }

        let frame = screen.frame
        let scale = screen.backingScaleFactor
        return CGSize(width: frame.width * scale, height: frame.height * scale)
    }

    return nil
}

private func constrainedCaptureSize(for displayId: UInt32) -> (width: Int, height: Int)? {
    guard let size = screenSize(for: displayId) else { return nil }
    let width = max(1, Int(size.width.rounded()))
    let height = max(1, Int(size.height.rounded()))
    let longestSide = max(width, height)
    guard longestSide > screenContextMaxCaptureDimension else {
        return (width, height)
    }

    let scale = Double(screenContextMaxCaptureDimension) / Double(longestSide)
    return (
        max(1, Int((Double(width) * scale).rounded())),
        max(1, Int((Double(height) * scale).rounded()))
    )
}

#if canImport(ScreenCaptureKit)
@available(macOS 14.0, *)
private func captureDisplayImage(displayId: UInt32) async throws -> CGImage {
    let shareableContent = try await SCShareableContent.current
    guard let display = shareableContent.displays.first(where: { $0.displayID == displayId }) else {
        throw NSError(
            domain: "VoxJotScreenContext",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Active display was unavailable for capture."]
        )
    }

    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    let configuration = SCStreamConfiguration()
    if let size = constrainedCaptureSize(for: displayId) {
        configuration.width = size.width
        configuration.height = size.height
    }
    configuration.showsCursor = false

    return try await SCScreenshotManager.captureImage(
        contentFilter: filter,
        configuration: configuration
    )
}
#endif

private func recognizeText(in image: CGImage, qualityMode: String, maxWords: Int) throws -> [OcrSnippet] {
    let request = VNRecognizeTextRequest()
    switch qualityMode.lowercased() {
    case "fast":
        request.recognitionLevel = .fast
    case "accurate":
        request.recognitionLevel = .accurate
    default:
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
    }

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    let snippets: [OcrSnippet] = (request.results as? [VNRecognizedTextObservation] ?? [])
        .compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            let box = observation.boundingBox
            return OcrSnippet(
                text: text,
                confidence: observation.confidence,
                x: box.origin.x,
                y: box.origin.y,
                width: box.size.width,
                height: box.size.height
            )
        }
        .sorted { lhs, rhs in
            if abs(lhs.confidence - rhs.confidence) > 0.001 {
                return lhs.confidence > rhs.confidence
            }
            return lhs.y > rhs.y
        }

    return clipSnippets(snippets, maxWords: maxWords)
}

@_cdecl("check_screen_recording_permission_apple")
public func checkScreenRecordingPermissionApple() -> Int32 {
    return CGPreflightScreenCaptureAccess() ? 1 : 0
}

@_cdecl("capture_screen_context_apple")
public func captureScreenContextApple(
    _ qualityMode: UnsafePointer<CChar>,
    _ maxWords: Int32,
    _ timeoutMs: Int32
) -> UnsafeMutablePointer<ScreenContextCaptureResponse> {
    let responsePtr = ScreenContextPointer.allocate(capacity: 1)
    responsePtr.initialize(
        to: ScreenContextCaptureResponse(json_payload: nil, success: 0, error_message: nil)
    )

    guard CGPreflightScreenCaptureAccess() else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Screen Recording permission is not granted."
        )
        return responsePtr
    }

    guard #available(macOS 14.0, *) else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Screen context capture requires macOS 14 or newer."
        )
        return responsePtr
    }

    guard let displayId = activeDisplayIdentifier() else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Could not determine the active display for screen capture."
        )
        return responsePtr
    }

    guard screenContextCaptureLock.try() else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "A screen context capture is already in progress."
        )
        return responsePtr
    }

    let swiftQualityMode = String(cString: qualityMode)
    let clippedMaxWords = max(0, Int(maxWords))
    let semaphore = DispatchSemaphore(value: 0)

    final class ResultBox: @unchecked Sendable {
        var payload: String?
        var error: String?
    }
    let box = ResultBox()

    Task.detached(priority: .userInitiated) {
        defer {
            screenContextCaptureLock.unlock()
            semaphore.signal()
        }

        do {
            #if canImport(ScreenCaptureKit)
            let image = try await captureDisplayImage(displayId: displayId)
            let snippets = try recognizeText(
                in: image,
                qualityMode: swiftQualityMode,
                maxWords: clippedMaxWords
            )
            let payload = ScreenContextPayload(
                display_id: displayId,
                captured_at_ms: Int64(Date().timeIntervalSince1970 * 1000),
                snippets: snippets
            )
            box.payload = encodePayload(payload)
            #else
            box.error = "ScreenCaptureKit is unavailable in this build."
            #endif
        } catch {
            box.error = error.localizedDescription
        }
    }

    let timeout = DispatchTime.now() + .milliseconds(max(100, Int(timeoutMs)))
    if semaphore.wait(timeout: timeout) == .timedOut {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Timed out while capturing screen context."
        )
        return responsePtr
    }

    if let payload = box.payload {
        responsePtr.pointee.json_payload = duplicateScreenCString(payload)
        responsePtr.pointee.success = 1
    } else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            box.error ?? "Unknown screen context capture error."
        )
    }

    return responsePtr
}

@_cdecl("free_screen_context_capture_response")
public func freeScreenContextCaptureResponse(
    _ response: UnsafeMutablePointer<ScreenContextCaptureResponse>?
) {
    guard let response else { return }

    if let payload = response.pointee.json_payload {
        free(UnsafeMutablePointer(mutating: payload))
    }

    if let errorMessage = response.pointee.error_message {
        free(UnsafeMutablePointer(mutating: errorMessage))
    }

    response.deallocate()
}

private typealias ScreenContextBitmapPointer = UnsafeMutablePointer<ScreenContextBitmapResponse>

private func renderBitmap(_ image: CGImage) -> (UnsafeMutablePointer<UInt8>, Int)? {
    let width = image.width
    let height = image.height
    guard width > 0, height > 0 else { return nil }

    let bytesPerRow = width * 4
    let totalBytes = bytesPerRow * height
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: totalBytes)
    buffer.initialize(repeating: 0, count: totalBytes)

    let bitmapInfo: UInt32 =
        CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    guard
        let context = CGContext(
            data: buffer,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: bitmapInfo
        )
    else {
        buffer.deinitialize(count: totalBytes)
        buffer.deallocate()
        return nil
    }

    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return (buffer, totalBytes)
}

@_cdecl("capture_screen_context_bitmap_apple")
public func captureScreenContextBitmapApple(
    _ timeoutMs: Int32
) -> UnsafeMutablePointer<ScreenContextBitmapResponse> {
    let responsePtr = ScreenContextBitmapPointer.allocate(capacity: 1)
    responsePtr.initialize(
        to: ScreenContextBitmapResponse(
            bgra: nil,
            width: 0,
            height: 0,
            stride: 0,
            display_id: 0,
            captured_at_ms: 0,
            success: 0,
            error_message: nil
        )
    )

    guard CGPreflightScreenCaptureAccess() else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Screen Recording permission is not granted."
        )
        return responsePtr
    }

    guard #available(macOS 14.0, *) else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Screen context bitmap capture requires macOS 14 or newer."
        )
        return responsePtr
    }

    guard let displayId = activeDisplayIdentifier() else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Could not determine the active display for screen capture."
        )
        return responsePtr
    }

    guard screenContextCaptureLock.try() else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "A screen context capture is already in progress."
        )
        return responsePtr
    }

    let semaphore = DispatchSemaphore(value: 0)

    final class ResultBox: @unchecked Sendable {
        var image: CGImage?
        var error: String?
    }
    let box = ResultBox()

    Task.detached(priority: .userInitiated) {
        defer {
            screenContextCaptureLock.unlock()
            semaphore.signal()
        }
        do {
            #if canImport(ScreenCaptureKit)
            box.image = try await captureDisplayImage(displayId: displayId)
            #else
            box.error = "ScreenCaptureKit is unavailable in this build."
            #endif
        } catch {
            box.error = error.localizedDescription
        }
    }

    let timeout = DispatchTime.now() + .milliseconds(max(100, Int(timeoutMs)))
    if semaphore.wait(timeout: timeout) == .timedOut {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Timed out while capturing the display bitmap."
        )
        return responsePtr
    }

    guard let image = box.image else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            box.error ?? "Unknown bitmap capture error."
        )
        return responsePtr
    }

    guard let (buffer, _) = renderBitmap(image) else {
        responsePtr.pointee.error_message = duplicateScreenCString(
            "Failed to render captured display image into a packed BGRA buffer."
        )
        return responsePtr
    }

    responsePtr.pointee.bgra = buffer
    responsePtr.pointee.width = UInt32(image.width)
    responsePtr.pointee.height = UInt32(image.height)
    responsePtr.pointee.stride = UInt32(image.width * 4)
    responsePtr.pointee.display_id = displayId
    responsePtr.pointee.captured_at_ms = Int64(Date().timeIntervalSince1970 * 1000)
    responsePtr.pointee.success = 1
    return responsePtr
}

@_cdecl("free_screen_context_bitmap_response")
public func freeScreenContextBitmapResponse(
    _ response: UnsafeMutablePointer<ScreenContextBitmapResponse>?
) {
    guard let response else { return }

    if let buffer = response.pointee.bgra {
        let total = Int(response.pointee.stride) * Int(response.pointee.height)
        if total > 0 {
            buffer.deinitialize(count: total)
        }
        buffer.deallocate()
    }

    if let errorMessage = response.pointee.error_message {
        free(UnsafeMutablePointer(mutating: errorMessage))
    }

    response.deallocate()
}
