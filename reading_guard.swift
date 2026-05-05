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
            state.blacklistUsageSeconds = [:]
            state.lastBlockedApp = ""
            state.lastBlockedAt = ""
            state.lastBlockedReason = ""
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

            if let matchedBlacklist = firstMatch(appName: frontmostApp, bundleID: frontmostBundleID, executableName: frontmostExecutable, against: config.blacklist) {
                let deltaSeconds = max(1, Int(elapsed.rounded(.down)))
                state.blacklistUsageSeconds[matchedBlacklist, default: 0] += deltaSeconds

                let usedSeconds = state.blacklistUsageSeconds[matchedBlacklist, default: 0]
                let dailyLimitSeconds = config.blacklistLimits[matchedBlacklist] ?? 3600
                let readingRequirementActive = state.readingSeconds < config.dailyReadingTargetSeconds
                let blacklistLimitReached = usedSeconds >= dailyLimitSeconds
                let blockReason = readingRequirementActive ? "reading_target" : (blacklistLimitReached ? "daily_limit" : "")

                if !blockReason.isEmpty, shouldBlock(frontmostApp: frontmostApp, state: state, reason: blockReason, now: now) {
                    quit(appName: frontmostApp, bundleID: frontmostBundleID, executableName: frontmostExecutable)
                    notify(
                        appName: frontmostApp,
                        requiredSeconds: config.dailyReadingTargetSeconds,
                        readingSeconds: state.readingSeconds,
                        blacklistLimitSeconds: dailyLimitSeconds,
                        blacklistUsedSeconds: usedSeconds,
                        reason: blockReason
                    )
                    state.lastBlockedApp = frontmostApp
                    state.lastBlockedAt = isoFormatter.string(from: now)
                    state.lastBlockedReason = blockReason
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
        let blacklistLimits = parseIntMap(guardRaw["blacklistLimits"], allowedKeys: blacklist, defaultValue: 3600)

        return ReadingGuardConfig(
            enabled: enabled,
            dailyReadingTargetSeconds: target,
            whitelist: whitelist,
            blacklist: blacklist,
            blacklistLimits: blacklistLimits
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
            blacklistUsageSeconds: parseIntMap(raw["blacklistUsageSeconds"], allowedKeys: nil, defaultValue: 0),
            currentFrontmostApp: raw["currentFrontmostApp"] as? String ?? "",
            currentFrontmostBundleID: raw["currentFrontmostBundleID"] as? String ?? "",
            currentFrontmostExecutable: raw["currentFrontmostExecutable"] as? String ?? "",
            lastObservedApp: raw["lastObservedApp"] as? String ?? "",
            lastObservedBundleID: raw["lastObservedBundleID"] as? String ?? "",
            lastBlockedApp: raw["lastBlockedApp"] as? String ?? "",
            lastBlockedAt: raw["lastBlockedAt"] as? String ?? "",
            lastBlockedReason: raw["lastBlockedReason"] as? String ?? ""
        )
    }

    private func saveState(_ state: ReadingGuardState) {
        try? fileManager.createDirectory(at: appDir, withIntermediateDirectories: true)
        let payload: [String: Any] = [
            "date": state.date,
            "readingSeconds": state.readingSeconds,
            "blacklistUsageSeconds": state.blacklistUsageSeconds,
            "currentFrontmostApp": state.currentFrontmostApp,
            "currentFrontmostBundleID": state.currentFrontmostBundleID,
            "currentFrontmostExecutable": state.currentFrontmostExecutable,
            "lastObservedApp": state.lastObservedApp,
            "lastObservedBundleID": state.lastObservedBundleID,
            "lastBlockedApp": state.lastBlockedApp,
            "lastBlockedAt": state.lastBlockedAt,
            "lastBlockedReason": state.lastBlockedReason,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else {
            return
        }
        try? data.write(to: stateURL, options: [.atomic])
    }

    private func shouldBlock(frontmostApp: String, state: ReadingGuardState, reason: String, now: Date) -> Bool {
        if state.lastBlockedApp.caseInsensitiveCompare(frontmostApp) != .orderedSame {
            return true
        }
        if state.lastBlockedReason != reason {
            return true
        }

        guard
            !state.lastBlockedAt.isEmpty,
            let blockedAt = isoFormatter.date(from: state.lastBlockedAt)
        else {
            return true
        }

        return now.timeIntervalSince(blockedAt) >= 1
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

    private func notify(appName: String, requiredSeconds: Int, readingSeconds: Int, blacklistLimitSeconds: Int, blacklistUsedSeconds: Int, reason: String) {
        let requiredMinutes = requiredSeconds / 60
        let readMinutes = readingSeconds / 60
        let limitMinutes = max(1, blacklistLimitSeconds / 60)
        let usedMinutes = blacklistUsedSeconds / 60
        let message: String
        if reason == "daily_limit" {
            message = "\(appName) 今日娱乐时长已达 \(limitMinutes) 分钟，已强制关闭。当前已使用 \(usedMinutes) 分钟。"
        } else {
            message = "今日阅读不足 \(requiredMinutes) 分钟，已强制关闭 \(appName)。当前仅累计 \(readMinutes) 分钟。"
        }
        runAppleScript("display notification \"\(escapeAppleScript(message))\" with title \"先读书，后娱乐\"")
    }

    private func runAppleScript(_ script: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
    }

    private func matches(appName: String, bundleID: String, executableName: String, against items: [String]) -> Bool {
        firstMatch(appName: appName, bundleID: bundleID, executableName: executableName, against: items) != nil
    }

    private func firstMatch(appName: String, bundleID: String, executableName: String, against items: [String]) -> String? {
        let candidates = [appName, bundleID, executableName]
            .map(normalizeMatchToken)
            .filter { !$0.isEmpty }

        return items.first { originalItem in
            let item = normalizeMatchToken(originalItem)
            guard !item.isEmpty else {
                return false
            }
            
            return candidates.contains(where: { candidate in
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

    private func parseIntMap(_ value: Any?, allowedKeys: [String]?, defaultValue: Int) -> [String: Int] {
        guard let raw = value as? [String: Any] else {
            return buildDefaultIntMap(keys: allowedKeys, defaultValue: defaultValue)
        }

        var parsed: [String: Int] = [:]
        for (key, item) in raw {
            let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedKey.isEmpty else {
                continue
            }

            let parsedValue: Int
            if let intValue = item as? Int {
                parsedValue = intValue
            } else if let stringValue = item as? String, let intValue = Int(stringValue) {
                parsedValue = intValue
            } else {
                parsedValue = defaultValue
            }

            parsed[trimmedKey] = max(0, parsedValue)
        }

        guard let allowedKeys else {
            return parsed
        }

        var filtered = buildDefaultIntMap(keys: allowedKeys, defaultValue: defaultValue)
        for key in allowedKeys where parsed[key] != nil {
            filtered[key] = max(60, parsed[key] ?? defaultValue)
        }
        return filtered
    }

    private func buildDefaultIntMap(keys: [String]?, defaultValue: Int) -> [String: Int] {
        guard let keys else {
            return [:]
        }

        var result: [String: Int] = [:]
        for key in keys {
            result[key] = max(60, defaultValue)
        }
        return result
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
    var blacklistLimits: [String: Int] = ["WeChat": 3600, "微信": 3600, "QQ": 3600, "网易云音乐": 3600, "Douyin": 3600]
}

struct ReadingGuardState {
    var date: String = ""
    var readingSeconds: Int = 0
    var blacklistUsageSeconds: [String: Int] = [:]
    var currentFrontmostApp: String = ""
    var currentFrontmostBundleID: String = ""
    var currentFrontmostExecutable: String = ""
    var lastObservedApp: String = ""
    var lastObservedBundleID: String = ""
    var lastBlockedApp: String = ""
    var lastBlockedAt: String = ""
    var lastBlockedReason: String = ""
}

let monitor = ReadingGuardMonitor()
monitor.run()
