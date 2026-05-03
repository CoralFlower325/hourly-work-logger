import AppKit
import Foundation

final class ReadingGuardMonitor {
    private let fileManager = FileManager.default
    private let appDir: URL
    private let configURL: URL
    private let stateURL: URL
    private let isoFormatter = ISO8601DateFormatter()
    private let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        return formatter
    }()
    private var lastTick = Date()

    init() {
        let home = fileManager.homeDirectoryForCurrentUser
        appDir = home.appendingPathComponent("Library/Application Support/HourlyWorkLogger", isDirectory: true)
        configURL = appDir.appendingPathComponent("config.json")
        stateURL = appDir.appendingPathComponent("reading-guard-state.json")
    }

    func run() {
        tick()
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            self.tick()
        }
        RunLoop.main.run()
    }

    private func tick() {
        let now = Date()
        let elapsed = min(max(now.timeIntervalSince(lastTick), 0), 3)
        lastTick = now

        let config = loadConfig()
        var state = loadState()
        let today = currentDayString(now)

        if state.date != today {
            state.date = today
            state.readingSeconds = 0
            state.lastBlockedApp = ""
            state.lastBlockedAt = ""
        }

        let frontmostApplication = NSWorkspace.shared.frontmostApplication
        let frontmostApp = frontmostApplication?.localizedName ?? ""
        let frontmostBundleID = frontmostApplication?.bundleIdentifier ?? ""
        let frontmostExecutable = frontmostApplication?.executableURL?.deletingPathExtension().lastPathComponent ?? ""
        state.currentFrontmostApp = frontmostApp
        state.currentFrontmostBundleID = frontmostBundleID
        state.currentFrontmostExecutable = frontmostExecutable

        if shouldRememberObservedApp(appName: frontmostApp, bundleID: frontmostBundleID, executableName: frontmostExecutable) {
            state.lastObservedApp = frontmostApp
            state.lastObservedBundleID = frontmostBundleID
        }

        if config.enabled {
            if matches(appName: frontmostApp, bundleID: frontmostBundleID, executableName: frontmostExecutable, against: config.whitelist) {
                let deltaSeconds = max(1, Int(elapsed.rounded(.down)))
                state.readingSeconds += deltaSeconds
            }

            if matches(appName: frontmostApp, bundleID: frontmostBundleID, executableName: frontmostExecutable, against: config.blacklist), state.readingSeconds < config.dailyReadingTargetSeconds {
                if shouldBlock(frontmostApp: frontmostApp, state: state, now: now) {
                    quit(appName: frontmostApp, bundleID: frontmostBundleID, executableName: frontmostExecutable)
                    notify(appName: frontmostApp, requiredSeconds: config.dailyReadingTargetSeconds, readingSeconds: state.readingSeconds)
                    state.lastBlockedApp = frontmostApp
                    state.lastBlockedAt = isoFormatter.string(from: now)
                }
            }
        }

        saveState(state)
    }

    private func loadConfig() -> ReadingGuardConfig {
        guard
            let data = try? Data(contentsOf: configURL),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let guardRaw = raw["readingGuard"] as? [String: Any]
        else {
            return ReadingGuardConfig()
        }

        let enabled = parseBool(guardRaw["enabled"]) ?? false
        let target = max(60, guardRaw["dailyReadingTargetSeconds"] as? Int ?? 1800)
        let whitelist = parseStringList(guardRaw["whitelist"])
        let blacklist = parseStringList(guardRaw["blacklist"])

        return ReadingGuardConfig(
            enabled: enabled,
            dailyReadingTargetSeconds: target,
            whitelist: whitelist,
            blacklist: blacklist
        )
    }

    private func loadState() -> ReadingGuardState {
        guard
            let data = try? Data(contentsOf: stateURL),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return ReadingGuardState()
        }

        return ReadingGuardState(
            date: raw["date"] as? String ?? "",
            readingSeconds: max(0, raw["readingSeconds"] as? Int ?? 0),
            currentFrontmostApp: raw["currentFrontmostApp"] as? String ?? "",
            currentFrontmostBundleID: raw["currentFrontmostBundleID"] as? String ?? "",
            currentFrontmostExecutable: raw["currentFrontmostExecutable"] as? String ?? "",
            lastObservedApp: raw["lastObservedApp"] as? String ?? "",
            lastObservedBundleID: raw["lastObservedBundleID"] as? String ?? "",
            lastBlockedApp: raw["lastBlockedApp"] as? String ?? "",
            lastBlockedAt: raw["lastBlockedAt"] as? String ?? ""
        )
    }

    private func saveState(_ state: ReadingGuardState) {
        try? fileManager.createDirectory(at: appDir, withIntermediateDirectories: true)
        let payload: [String: Any] = [
            "date": state.date,
            "readingSeconds": state.readingSeconds,
            "currentFrontmostApp": state.currentFrontmostApp,
            "currentFrontmostBundleID": state.currentFrontmostBundleID,
            "currentFrontmostExecutable": state.currentFrontmostExecutable,
            "lastObservedApp": state.lastObservedApp,
            "lastObservedBundleID": state.lastObservedBundleID,
            "lastBlockedApp": state.lastBlockedApp,
            "lastBlockedAt": state.lastBlockedAt,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else {
            return
        }
        try? data.write(to: stateURL, options: [.atomic])
    }

    private func shouldBlock(frontmostApp: String, state: ReadingGuardState, now: Date) -> Bool {
        if state.lastBlockedApp.caseInsensitiveCompare(frontmostApp) != .orderedSame {
            return true
        }

        guard
            !state.lastBlockedAt.isEmpty,
            let blockedAt = isoFormatter.date(from: state.lastBlockedAt)
        else {
            return true
        }

        return now.timeIntervalSince(blockedAt) >= 5
    }

    private func quit(appName: String, bundleID: String, executableName: String) {
        let matchingApps = NSWorkspace.shared.runningApplications.filter { application in
            matches(
                appName: application.localizedName ?? "",
                bundleID: application.bundleIdentifier ?? "",
                executableName: application.executableURL?.deletingPathExtension().lastPathComponent ?? "",
                against: [appName, bundleID, executableName]
            )
        }

        for application in matchingApps {
            let terminated = application.terminate()
            if !terminated {
                application.forceTerminate()
                continue
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                if !application.isTerminated {
                    application.forceTerminate()
                }
            }
        }

        if matchingApps.isEmpty {
            runAppleScript("tell application \"\(escapeAppleScript(appName))\" to quit")
        }
    }

    private func notify(appName: String, requiredSeconds: Int, readingSeconds: Int) {
        let requiredMinutes = requiredSeconds / 60
        let readMinutes = readingSeconds / 60
        let message = "今日阅读不足 \(requiredMinutes) 分钟，已强制关闭 \(appName)。当前仅累计 \(readMinutes) 分钟。"
        runAppleScript("display notification \"\(escapeAppleScript(message))\" with title \"先读书，后娱乐\"")
    }

    private func runAppleScript(_ script: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
    }

    private func matches(appName: String, bundleID: String, executableName: String, against items: [String]) -> Bool {
        let candidates = [appName, bundleID, executableName]
            .map(normalizeMatchToken)
            .filter { !$0.isEmpty }

        return items
            .map(normalizeMatchToken)
            .filter { !$0.isEmpty }
            .contains { item in
                candidates.contains(where: { candidate in
                    candidate == item || candidate.contains(item) || item.contains(candidate)
                })
            }
    }

    private func normalizeMatchToken(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: ".app", with: "")
    }

    private func shouldRememberObservedApp(appName: String, bundleID: String, executableName: String) -> Bool {
        let ignoredTokens = [
            "codex",
            "osascript",
            "python",
            "python3",
            "reading_guard",
            "hourly-work-logger",
        ]

        let candidates = [appName, bundleID, executableName].map(normalizeMatchToken)
        return candidates.contains { candidate in
            !candidate.isEmpty && !ignoredTokens.contains(where: { candidate.contains($0) })
        }
    }

    private func parseStringList(_ value: Any?) -> [String] {
        if let array = value as? [String] {
            return array.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
        if let text = value as? String {
            return text
                .replacingOccurrences(of: ",", with: "\n")
                .split(whereSeparator: \.isNewline)
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
        return []
    }

    private func parseBool(_ value: Any?) -> Bool? {
        if let boolValue = value as? Bool {
            return boolValue
        }
        if let stringValue = value as? String {
            return ["1", "true", "yes", "on"].contains(stringValue.lowercased())
        }
        return nil
    }

    private func currentDayString(_ now: Date) -> String {
        dayFormatter.string(from: now)
    }

    private func escapeAppleScript(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    }
}

struct ReadingGuardConfig {
    var enabled: Bool = false
    var dailyReadingTargetSeconds: Int = 1800
    var whitelist: [String] = ["图书", "Books", "预览", "Preview", "Kindle"]
    var blacklist: [String] = ["WeChat", "微信", "QQ", "网易云音乐", "Douyin"]
}

struct ReadingGuardState {
    var date: String = ""
    var readingSeconds: Int = 0
    var currentFrontmostApp: String = ""
    var currentFrontmostBundleID: String = ""
    var currentFrontmostExecutable: String = ""
    var lastObservedApp: String = ""
    var lastObservedBundleID: String = ""
    var lastBlockedApp: String = ""
    var lastBlockedAt: String = ""
}

let monitor = ReadingGuardMonitor()
monitor.run()
