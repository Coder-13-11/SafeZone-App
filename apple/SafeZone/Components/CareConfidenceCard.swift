import SwiftUI

struct CareConfidenceCard: View {
    let confidence: CareConfidence
    @State private var showsDetails = false

    private var tint: Color {
        switch confidence.level {
        case .excellent, .good: SafeZoneTheme.safe
        case .needsAttention: SafeZoneTheme.caution
        case .critical: SafeZoneTheme.alert
        }
    }

    var body: some View {
        Button {
            withAnimation(.snappy) {
                showsDetails.toggle()
            }
        } label: {
            VStack(spacing: 18) {
                HStack(spacing: 16) {
                    ZStack {
                        Circle()
                            .stroke(tint.opacity(0.18), lineWidth: 7)
                        Circle()
                            .trim(from: 0, to: Double(confidence.score) / 100)
                            .stroke(tint, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(confidence.score)%")
                            .font(.headline.monospacedDigit())
                    }
                    .frame(width: 72, height: 72)
                    .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("CARE CONFIDENCE")
                            .font(.caption2.weight(.semibold))
                            .tracking(0.8)
                            .foregroundStyle(.secondary)
                        Text(confidence.level.rawValue)
                            .font(.title2.weight(.bold))
                        Text(confidence.summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.down")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(showsDetails ? 180 : 0))
                }

                if showsDetails {
                    Divider()

                    VStack(spacing: 13) {
                        ForEach(confidence.signals) { signal in
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(signal.isHealthy ? SafeZoneTheme.safe : SafeZoneTheme.caution)
                                    .frame(width: 8, height: 8)
                                    .accessibilityHidden(true)
                                Text(signal.name)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(signal.value)
                                    .fontWeight(.semibold)
                                    .multilineTextAlignment(.trailing)
                            }
                            .font(.subheadline)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .safeZoneCard()
        .accessibilityLabel("Care Confidence \(confidence.level.rawValue), \(confidence.score) percent")
        .accessibilityHint(showsDetails ? "Hides confidence details" : "Shows confidence details")
    }
}
