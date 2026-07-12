import SwiftUI

struct FamilyCoordinationCard: View {
    let caregivers: [CaregiverPresence]
    let currentCaregiver: String
    let alertActive: Bool
    let careResponse: CareResponse?
    let onRespond: () -> Void

    private var visibleCaregivers: [CaregiverPresence] {
        caregivers.isEmpty
            ? [CaregiverPresence(id: "self", label: currentCaregiver)]
            : caregivers
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("FAMILY")
                            .font(.caption2.weight(.semibold))
                            .tracking(0.8)
                            .foregroundStyle(.secondary)
                        Text("Care team")
                            .font(.title2.bold())
                    }
                } icon: {
                    Image(systemName: "person.2.fill")
                        .foregroundStyle(SafeZoneTheme.safe)
                }

                Spacer()

                Text("\(visibleCaregivers.count)")
                    .font(.headline)
                    .foregroundStyle(SafeZoneTheme.safe)
                    .frame(width: 36, height: 36)
                    .background(SafeZoneTheme.safe.opacity(0.12), in: Circle())
            }

            VStack(spacing: 14) {
                ForEach(visibleCaregivers) { caregiver in
                    HStack(spacing: 12) {
                        Text(String(caregiver.label.prefix(1)).uppercased())
                            .font(.headline)
                            .frame(width: 42, height: 42)
                            .foregroundStyle(.primary)
                            .background(Color.secondary.opacity(0.12), in: Circle())

                        VStack(alignment: .leading, spacing: 2) {
                            Text(caregiver.label)
                                .font(.headline)
                            Text(statusText(for: caregiver))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Circle()
                            .fill(SafeZoneTheme.safe)
                            .frame(width: 9, height: 9)
                            .accessibilityLabel("Online")
                    }
                }
            }

            if alertActive {
                Button(action: onRespond) {
                    Label(
                        responseButtonTitle,
                        systemImage: careResponse == nil ? "hand.raised.fill" : "checkmark.circle.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(SafeZoneTheme.alert)
                .disabled(careResponse != nil)
                .controlSize(.large)
            }
        }
        .safeZoneCard()
    }

    private func statusText(for caregiver: CaregiverPresence) -> String {
        if careResponse?.caregiverLabel == caregiver.label {
            return "Responding"
        }
        return caregiver.label == currentCaregiver ? "You’re currently viewing" : "Currently viewing"
    }

    private var responseButtonTitle: String {
        guard let careResponse else { return "I’m responding" }
        return careResponse.status == .helpRequested
            ? "\(careResponse.caregiverLabel) requested help"
            : "\(careResponse.caregiverLabel) is responding"
    }
}
