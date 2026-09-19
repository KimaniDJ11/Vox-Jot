import Foundation

/// Generation-token capture gate.
///
/// Only the capture generation that currently owns the gate may release it.
/// A timed-out owner's stale `end(token)` must not clear a successor's ownership.
///
/// Uses `NSLock` (not `OSAllocatedUnfairLock`) so the type compiles under the
/// project's macOS 11.0 Swift deployment target.
final class ScreenContextCaptureGate: @unchecked Sendable {
    private var nextToken: UInt64 = 0
    private var owner: UInt64?
    private let lock = NSLock()

    /// Begin a capture. Returns an ownership token, or `nil` if busy.
    func tryBegin() -> UInt64? {
        lock.lock()
        defer { lock.unlock() }
        guard owner == nil else {
            return nil
        }
        nextToken &+= 1
        if nextToken == 0 {
            nextToken = 1
        }
        owner = nextToken
        return nextToken
    }

    /// Release ownership only if `token` is the current owner.
    func end(_ token: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        if owner == token {
            owner = nil
        }
    }
}
