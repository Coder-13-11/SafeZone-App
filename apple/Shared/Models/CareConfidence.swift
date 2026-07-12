import Foundation

enum ConnectionStatus: Sendable {
    case connecting
    case live
    case unavailable
}

enum CareConfidenceLevel: String, Sendable {
    case excellent = "Excellent"
    case good = "Good"
    case needsAttention = "Needs Attention"
    case critical = "Critical"
}

struct ConfidenceSignal: Identifiable, Sendable {
    let id = UUID()
    let name: String
    let value: String
    let isHealthy: Bool
}

struct CareConfidence: Sendable {
    let score: Int
    let level: CareConfidenceLevel
    let summary: String
    let signals: [ConfidenceSignal]

    static func evaluate(
        ping: LocationPing?,
        connection: ConnectionStatus,
        now: Date = .now
    ) -> CareConfidence {
        guard let ping else {
            return CareConfidence(
                score: 0,
                level: .needsAttention,
                summary: "Waiting for the patient device to share its location.",
                signals: [
                    ConfidenceSignal(name: "Location", value: "Not available", isHealthy: false),
                    ConfidenceSignal(name: "Connection", value: "Waiting", isHealthy: false)
                ]
            )
        }

        let age = max(0, now.timeIntervalSince(ping.timestamp))
        let accuracy = ping.accuracy ?? 100
        var score = 100

        if connection != .live { score -= 35 }
        if age > 120 { score -= 40 }
        else if age > 60 { score -= 25 }
        else if age > 20 { score -= 10 }

        if accuracy > 80 { score -= 25 }
        else if accuracy > 35 { score -= 15 }
        else if accuracy > 15 { score -= 7 }

        if let battery = ping.battery {
            if battery < 10 { score -= 25 }
            else if battery < 25 { score -= 10 }
        }

        switch ping.stateAtTime {
        case .alert: score -= 35
        case .grace: score -= 20
        case .caution: score -= 8
        case .safe, .unknown: break
        }

        score = min(100, max(0, score))
        let level: CareConfidenceLevel =
            score >= 90 ? .excellent :
            score >= 70 ? .good :
            score >= 40 ? .needsAttention : .critical

        let summary: String = switch level {
        case .excellent: "Location is current and the patient device is reporting clearly."
        case .good: "SafeZone has enough current information to provide a reliable status."
        case .needsAttention: "Some safety signals need attention."
        case .critical: "SafeZone cannot provide a reliable current status."
        }

        return CareConfidence(
            score: score,
            level: level,
            summary: summary,
            signals: [
                ConfidenceSignal(
                    name: "Last update",
                    value: ping.timestamp.formatted(.relative(presentation: .named)),
                    isHealthy: age <= 60
                ),
                ConfidenceSignal(
                    name: "Location clarity",
                    value: ping.accuracy.map { "About \(Int($0.rounded())) m" } ?? "Unknown",
                    isHealthy: accuracy <= 35
                ),
                ConfidenceSignal(
                    name: "Connection",
                    value: connection == .live ? "Live" : "Interrupted",
                    isHealthy: connection == .live
                ),
                ConfidenceSignal(
                    name: "Patient device",
                    value: ping.battery.map { "\(Int($0.rounded()))% battery" } ?? "Battery unavailable",
                    isHealthy: ping.battery.map { $0 >= 25 } ?? true
                ),
                ConfidenceSignal(
                    name: "Movement status",
                    value: ping.stateAtTime.title,
                    isHealthy: ping.stateAtTime == .safe
                )
            ]
        )
    }
}
