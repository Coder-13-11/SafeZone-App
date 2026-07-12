import SwiftUI

struct CaregiverHomeView: View {
    @StateObject private var viewModel: CaregiverHomeViewModel

    init(viewModel: CaregiverHomeViewModel = CaregiverHomeViewModel()) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 10)) { _ in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        SafetyHeroCard(
                            patientName: viewModel.patientName,
                            state: viewModel.safetyState,
                            zoneName: viewModel.activeZoneName,
                            lastUpdated: viewModel.latestPing?.timestamp,
                            connection: viewModel.connection
                        )

                        if viewModel.safetyState.requiresAction {
                            AlertActionCard(
                                patientName: viewModel.patientName,
                                hasResponder: viewModel.respondingCaregiverId != nil,
                                onRespond: viewModel.acknowledgeAlert
                            )
                            .transition(.scale.combined(with: .opacity))
                        }

                        CareConfidenceCard(confidence: viewModel.confidence)

                        LiveLocationMapCard(
                            patientName: viewModel.patientName,
                            latestPing: viewModel.latestPing,
                            history: viewModel.history,
                            zones: viewModel.zones
                        )

                        CareTimelineCard(events: viewModel.timeline)

                        FamilyCoordinationCard(
                            caregivers: viewModel.caregivers,
                            currentCaregiver: viewModel.caregiverName,
                            alertActive: viewModel.safetyState.requiresAction,
                            careResponse: viewModel.careResponse,
                            onRespond: viewModel.acknowledgeAlert
                        )

                        if let errorMessage = viewModel.errorMessage {
                            Label(errorMessage, systemImage: "wifi.exclamationmark")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding()
                                .accessibilityAddTraits(.isStaticText)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                }
                .background(Color(uiColor: .systemGroupedBackground))
            }
            .navigationTitle("SafeZone")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await viewModel.start()
            }
            .onDisappear {
                viewModel.stop()
            }
        }
    }
}

private struct AlertActionCard: View {
    let patientName: String
    let hasResponder: Bool
    let onRespond: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Action needed", systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
                .foregroundStyle(SafeZoneTheme.alert)

            Text("Open the live map and let your family know who is responding.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack {
                Button(action: onRespond) {
                    Label(hasResponder ? "You’re responding" : "I’m responding", systemImage: "hand.raised.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(SafeZoneTheme.alert)
                .disabled(hasResponder)

                Button {
                    // A verified patient phone number belongs in the household profile.
                } label: {
                    Image(systemName: "phone.fill")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.bordered)
                .disabled(true)
                .accessibilityLabel("Call \(patientName)")
                .accessibilityHint("Available after a verified phone number is added")
            }
        }
        .safeZoneCard()
    }
}
