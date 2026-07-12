import SwiftUI

struct SafetyHeroCard: View {
    let patientName: String
    let state: SafetyState
    let zoneName: String
    let lastUpdated: Date?
    let connection: ConnectionStatus

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var statusColor: Color {
        SafeZoneTheme.color(for: state)
    }

    private var updateText: String {
        guard let lastUpdated else { return "Waiting for patient device" }
        return "Updated \(lastUpdated.formatted(.relative(presentation: .named)))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(SafeZoneTheme.safe.opacity(0.16))
                    Text(initials)
                        .font(.headline)
                        .foregroundStyle(SafeZoneTheme.safe)
                }
                .frame(width: 52, height: 52)
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text("PATIENT")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(patientName)
                        .font(.title3.weight(.semibold))
                }

                Spacer()

                Label(connectionTitle, systemImage: connection == .live ? "wave.3.right.circle.fill" : "wifi.exclamationmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(connection == .live ? SafeZoneTheme.safe : .secondary)
            }

            Divider()

            HStack(alignment: .top, spacing: 16) {
                Image(systemName: state == .safe ? "checkmark" : state == .alert ? "exclamationmark" : "ellipsis")
                    .font(.title.bold())
                    .foregroundStyle(Color(uiColor: .systemBackground))
                    .frame(width: 64, height: 64)
                    .background(statusColor, in: Circle())
                    .shadow(color: statusColor.opacity(0.28), radius: 0, x: 0, y: 0)
                    .symbolEffect(.pulse, options: .nonRepeating, isActive: !reduceMotion && state == .alert)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 5) {
                    Text(state.title.uppercased())
                        .font(.caption.weight(.bold))
                        .tracking(1.1)
                        .foregroundStyle(statusColor)
                    Text(state.message(patientName: patientName, zoneName: zoneName))
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .minimumScaleFactor(0.72)
                }
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(reassurance)
                    .font(.headline)
                Text(updateText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(statusColor.opacity(0.13), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .safeZoneCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(patientName). \(state.message(patientName: patientName, zoneName: zoneName)). \(updateText)")
    }

    private var initials: String {
        patientName
            .split(separator: " ")
            .prefix(2)
            .compactMap(\.first)
            .map(String.init)
            .joined()
    }

    private var connectionTitle: String {
        switch connection {
        case .live: "Live"
        case .connecting: "Connecting"
        case .unavailable: "Unavailable"
        }
    }

    private var reassurance: String {
        switch state {
        case .safe: "SafeZone is watching. We’ll let you know if this changes."
        case .caution: "No emergency alert has been sent."
        case .grace: "SafeZone is confirming the boundary crossing."
        case .alert: "A caregiver should respond now."
        case .unknown: "Showing the last known information."
        }
    }
}
