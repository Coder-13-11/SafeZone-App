import SwiftUI

struct CareTimelineCard: View {
    let events: [CaregiverHomeViewModel.TimelineEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY")
                        .font(.caption2.weight(.semibold))
                        .tracking(0.8)
                        .foregroundStyle(.secondary)
                    Text("Recent activity")
                        .font(.title2.bold())
                }
            } icon: {
                Image(systemName: "clock.arrow.circlepath")
                    .foregroundStyle(SafeZoneTheme.safe)
            }

            if events.isEmpty {
                ContentUnavailableView(
                    "No activity yet",
                    systemImage: "figure.walk.motion",
                    description: Text("Meaningful location changes will appear here.")
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        HStack(alignment: .top, spacing: 12) {
                            Text(event.date, format: .dateTime.hour().minute())
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 66, alignment: .leading)

                            VStack(spacing: 0) {
                                Circle()
                                    .fill(SafeZoneTheme.color(for: event.state))
                                    .frame(width: 10, height: 10)
                                if index < events.count - 1 {
                                    Rectangle()
                                        .fill(Color.secondary.opacity(0.18))
                                        .frame(width: 2, height: 42)
                                }
                            }
                            .padding(.top, 4)
                            .accessibilityHidden(true)

                            VStack(alignment: .leading, spacing: 3) {
                                Text(event.title)
                                    .font(.headline)
                                Text(event.detail)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .safeZoneCard()
    }
}
