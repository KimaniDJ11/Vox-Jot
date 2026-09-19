import Foundation

// Deterministic stale-owner release harness for ScreenContextCaptureGate.
// Compile with:
//   xcrun swiftc -parse-as-library \\
//     src-tauri/swift/screen_context_capture_gate.swift \\
//     scripts/test-screen-context-capture-gate.swift \\
//     -o /tmp/test-screen-context-capture-gate

@main
enum ScreenContextCaptureGateHarness {
    static func main() {
        let gate = ScreenContextCaptureGate()

        guard let tokenA = gate.tryBegin() else {
            fputs("FAIL: A could not begin\n", stderr)
            exit(1)
        }

        // Simulate A waiter timeout releasing ownership.
        gate.end(tokenA)

        guard let tokenB = gate.tryBegin() else {
            fputs("FAIL: B could not begin after A released\n", stderr)
            exit(1)
        }

        // Stale A defer must not clear B.
        gate.end(tokenA)

        if gate.tryBegin() != nil {
            fputs("FAIL: C began while B still owns the gate\n", stderr)
            exit(1)
        }

        gate.end(tokenB)

        guard gate.tryBegin() != nil else {
            fputs("FAIL: C could not begin after B released\n", stderr)
            exit(1)
        }

        fputs("PASS: stale A → B → stale A end → C rejected; then B end → C begins\n", stderr)
        exit(0)
    }
}
