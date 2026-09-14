import AppKit
import Foundation
import Darwin

public typealias AuthorizedResponsePointer = UnsafeMutablePointer<AuthorizedFileResponse>

private func authorizedSuccess(_ value: String) -> AuthorizedResponsePointer {
    let response = AuthorizedResponsePointer.allocate(capacity: 1)
    response.initialize(
        to: AuthorizedFileResponse(
            value: strdup(value),
            success: 1,
            error_message: nil
        )
    )
    return response
}

private func authorizedFailure(_ message: String) -> AuthorizedResponsePointer {
    let response = AuthorizedResponsePointer.allocate(capacity: 1)
    response.initialize(
        to: AuthorizedFileResponse(
            value: nil,
            success: 0,
            error_message: strdup(message)
        )
    )
    return response
}

private func resolveAuthorizedDirectory(_ bookmarkBase64: UnsafePointer<CChar>?) throws -> URL {
    guard let bookmarkBase64 else {
        throw NSError(
            domain: "VoxJotMarkdownExport",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Folder authorization is missing."]
        )
    }
    guard let bookmarkData = Data(base64Encoded: String(cString: bookmarkBase64)) else {
        throw NSError(
            domain: "VoxJotMarkdownExport",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Folder authorization is invalid. Choose the folder again."]
        )
    }

    var isStale = false
    let directory = try URL(
        resolvingBookmarkData: bookmarkData,
        options: [.withSecurityScope, .withoutUI],
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
    )
    if isStale {
        throw NSError(
            domain: "VoxJotMarkdownExport",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Folder authorization expired. Choose the export folder again."]
        )
    }
    return directory
}

private func safeTarget(directory: URL, filenamePointer: UnsafePointer<CChar>?) throws -> URL {
    guard let filenamePointer else {
        throw NSError(
            domain: "VoxJotMarkdownExport",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "The export filename is missing."]
        )
    }
    let filename = String(cString: filenamePointer)
    guard !filename.isEmpty,
          filename.hasSuffix(".md"),
          filename == URL(fileURLWithPath: filename).lastPathComponent else {
        throw NSError(
            domain: "VoxJotMarkdownExport",
            code: 5,
            userInfo: [NSLocalizedDescriptionKey: "The export filename is invalid."]
        )
    }
    return directory.appendingPathComponent(filename, isDirectory: false)
}

@_cdecl("create_security_scoped_bookmark_apple")
public func createSecurityScopedBookmarkApple(
    _ directoryPath: UnsafePointer<CChar>?
) -> AuthorizedResponsePointer {
    guard let directoryPath else {
        return authorizedFailure("The selected folder path is missing.")
    }
    let directory = URL(fileURLWithPath: String(cString: directoryPath), isDirectory: true)
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory),
          isDirectory.boolValue else {
        return authorizedFailure("The selected Markdown export folder is unavailable.")
    }

    let accessed = directory.startAccessingSecurityScopedResource()
    defer {
        if accessed { directory.stopAccessingSecurityScopedResource() }
    }
    do {
        let bookmark = try directory.bookmarkData(
            options: .withSecurityScope,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        return authorizedSuccess(bookmark.base64EncodedString())
    } catch {
        return authorizedFailure("Could not preserve access to the selected folder: \(error.localizedDescription)")
    }
}

@_cdecl("write_security_scoped_file_apple")
public func writeSecurityScopedFileApple(
    _ bookmarkBase64: UnsafePointer<CChar>?,
    _ filename: UnsafePointer<CChar>?,
    _ content: UnsafePointer<CChar>?
) -> AuthorizedResponsePointer {
    guard let content else {
        return authorizedFailure("The Markdown content is missing.")
    }
    do {
        let directory = try resolveAuthorizedDirectory(bookmarkBase64)
        let target = try safeTarget(directory: directory, filenamePointer: filename)
        let accessed = directory.startAccessingSecurityScopedResource()
        defer {
            if accessed { directory.stopAccessingSecurityScopedResource() }
        }
        let data = Data(String(cString: content).utf8)
        let temporary = directory.appendingPathComponent(".vox-jot-export-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try data.write(to: temporary, options: .withoutOverwriting)
        // Exclusive rename is atomic and cannot overwrite an existing note.
        let renamed = temporary.withUnsafeFileSystemRepresentation { source in
            target.withUnsafeFileSystemRepresentation { destination in
                renamex_np(source!, destination!, UInt32(RENAME_EXCL))
            }
        }
        if renamed != 0 {
            let renameError = errno
            let values = try? target.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            let identical = renameError == EEXIST
                && values?.isRegularFile == true && values?.isSymbolicLink != true
                && values?.fileSize == data.count && (try? Data(contentsOf: target)) == data
            if !identical {
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(renameError), userInfo: [
                    NSLocalizedDescriptionKey: "An existing note was not overwritten, or the export could not be finalized."
                ])
            }
        }
        return authorizedSuccess(target.path)
    } catch {
        return authorizedFailure("Could not write the Markdown export: \(error.localizedDescription)")
    }
}

@_cdecl("test_security_scoped_file_write_apple")
public func testSecurityScopedFileWriteApple(
    _ bookmarkBase64: UnsafePointer<CChar>?,
    _ filename: UnsafePointer<CChar>?,
    _ content: UnsafePointer<CChar>?
) -> AuthorizedResponsePointer {
    guard let content else {
        return authorizedFailure("The Markdown test content is missing.")
    }
    do {
        let directory = try resolveAuthorizedDirectory(bookmarkBase64)
        let target = try safeTarget(directory: directory, filenamePointer: filename)
        let accessed = directory.startAccessingSecurityScopedResource()
        defer {
            if accessed { directory.stopAccessingSecurityScopedResource() }
        }

        var createdTestFile = false
        defer {
            if createdTestFile {
                try? FileManager.default.removeItem(at: target)
            }
        }
        try Data(String(cString: content).utf8).write(
            to: target,
            options: .withoutOverwriting
        )
        createdTestFile = true
        try FileManager.default.removeItem(at: target)
        createdTestFile = false
        return authorizedSuccess(directory.path)
    } catch {
        return authorizedFailure("Could not write to the Markdown export folder: \(error.localizedDescription)")
    }
}

@_cdecl("reveal_security_scoped_file_apple")
public func revealSecurityScopedFileApple(
    _ bookmarkBase64: UnsafePointer<CChar>?,
    _ filename: UnsafePointer<CChar>?
) -> AuthorizedResponsePointer {
    do {
        let directory = try resolveAuthorizedDirectory(bookmarkBase64)
        let target = try safeTarget(directory: directory, filenamePointer: filename)
        let accessed = directory.startAccessingSecurityScopedResource()
        defer {
            if accessed { directory.stopAccessingSecurityScopedResource() }
        }
        guard FileManager.default.fileExists(atPath: target.path) else {
            return authorizedFailure("The exported Markdown file could not be found.")
        }
        let reveal = {
            NSWorkspace.shared.activateFileViewerSelecting([target])
        }
        if Thread.isMainThread {
            reveal()
        } else {
            DispatchQueue.main.sync(execute: reveal)
        }
        return authorizedSuccess(target.path)
    } catch {
        return authorizedFailure("Could not reveal the Markdown export: \(error.localizedDescription)")
    }
}

@_cdecl("free_authorized_file_response")
public func freeAuthorizedFileResponse(_ response: AuthorizedResponsePointer?) {
    guard let response else { return }
    if let value = response.pointee.value {
        free(UnsafeMutablePointer(mutating: value))
    }
    if let errorMessage = response.pointee.error_message {
        free(UnsafeMutablePointer(mutating: errorMessage))
    }
    response.deinitialize(count: 1)
    response.deallocate()
}
