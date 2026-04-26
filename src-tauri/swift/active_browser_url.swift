import Foundation

private let browserScripts: [String: String] = [
    "com.apple.Safari": "tell application \"Safari\" to return URL of current tab of front window",
    "com.google.Chrome": "tell application \"Google Chrome\" to return URL of active tab of front window",
    "company.thebrowser.Browser": "tell application \"Arc\" to return URL of active tab of front window",
    "org.mozilla.firefox": "tell application \"Firefox\" to return URL of front window",
    "com.brave.Browser": "tell application \"Brave Browser\" to return URL of active tab of front window",
    "com.microsoft.edgemac": "tell application \"Microsoft Edge\" to return URL of active tab of front window",
]

@_cdecl("active_browser_url_for_bundle_id")
public func activeBrowserURLForBundleID(_ bundleId: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let bundleId else {
        return nil
    }

    let id = String(cString: bundleId)
    guard let source = browserScripts[id] else {
        return nil
    }

    var error: NSDictionary?
    guard let script = NSAppleScript(source: source) else {
        return nil
    }

    let output = script.executeAndReturnError(&error)
    if error != nil {
        return nil
    }

    guard let url = output.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
          !url.isEmpty else {
        return nil
    }

    return strdup(url)
}
