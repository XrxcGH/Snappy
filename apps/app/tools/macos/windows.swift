// Lists the windows the macOS window server reports, and says which belong to one process.
// Used by apps/app/tools/macos/smoke.sh in CI:  swift windows.swift <pid>
//
// Output, one line each:
//   total=<n>                      every window the window server lists (0 means this session has no window server access)
//   mine=<n>                       windows owned by <pid>
//   window id=<id> layer=<n> x=<> y=<> w=<> h=<> name=<title or empty>
//
// The window title (kCGWindowName) is only given to a process that has the Screen Recording permission; an empty name
// does not mean the window has no title. The id, the size and the owner need no permission.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count > 1, let pid = Int32(CommandLine.arguments[1]) else {
    print("usage: swift windows.swift <pid>")
    exit(2)
}

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    print("total=0")
    print("mine=0")
    exit(0)
}

var mine: [[String: Any]] = []
for window in list {
    if let owner = window[kCGWindowOwnerPID as String] as? Int32, owner == pid {
        mine.append(window)
    }
}

print("total=\(list.count)")
print("mine=\(mine.count)")
for window in mine {
    let id = window[kCGWindowNumber as String] as? Int ?? -1
    let layer = window[kCGWindowLayer as String] as? Int ?? -1
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    func number(_ key: String) -> Int {
        if let d = bounds[key] as? Double { return Int(d) }
        if let i = bounds[key] as? Int { return i }
        return -1
    }
    let name = window[kCGWindowName as String] as? String ?? ""
    print("window id=\(id) layer=\(layer) x=\(number("X")) y=\(number("Y")) w=\(number("Width")) h=\(number("Height")) name=\(name)")
}
