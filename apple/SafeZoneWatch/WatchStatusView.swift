import SwiftUI

struct WatchStatusView: View {
    @StateObject private var viewModel = WatchStatusViewModel()
    @State private var showsAssistance = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 10) {
                Spacer(minLength: 0)

                Image(systemName: statusSymbol)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(width: 58, height: 58)
                    .background(SafeZoneTheme.color(for: viewModel.state), in: Circle())
                    .accessibilityHidden(true)

                Text(viewModel.state.title)
                    .font(.title2.bold())

                Text(watchMessage)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let timestamp = viewModel.ping?.timestamp {
                    Text("Updated \(timestamp.formatted(.relative(presentation: .named)))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Spacer(minLength: 0)

                Button {
                    showsAssistance = true
                } label: {
                    Label("Get help", systemImage: "hand.raised.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(viewModel.state == .alert ? SafeZoneTheme.alert : SafeZoneTheme.safe)
            }
            .padding(.horizontal, 8)
            .navigationTitle("SafeZone")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showsAssistance) {
                AssistanceView(
                    patientName: viewModel.patientName,
                    helpRequested: viewModel.helpRequested,
                    onRequestHelp: viewModel.requestHelp
                )
            }
            .task {
                await viewModel.start()
            }
            .onDisappear {
                viewModel.stop()
            }
            .accessibilityElement(children: .contain)
        }
    }

    private var statusSymbol: String {
        switch viewModel.state {
        case .safe: "checkmark"
        case .caution, .grace: "ellipsis"
        case .alert: "exclamationmark"
        case .unknown: "wifi.exclamationmark"
        }
    }

    private var watchMessage: String {
        switch viewModel.state {
        case .safe: "You’re safe. Your family can see your location."
        case .caution: "You’re near the edge of your safe area."
        case .grace: "SafeZone is checking your location."
        case .alert: "Your family has been notified."
        case .unknown: "Stay calm. SafeZone is reconnecting."
        }
    }
}

private struct AssistanceView: View {
    let patientName: String
    let helpRequested: Bool
    let onRequestHelp: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: helpRequested ? "checkmark.circle.fill" : "hand.raised.fill")
                .font(.largeTitle)
                .foregroundStyle(helpRequested ? SafeZoneTheme.safe : SafeZoneTheme.caution)

            Text(helpRequested ? "Help requested" : "Need assistance?")
                .font(.headline)

            Text(
                helpRequested
                    ? "Stay where you are if it is safe. Your caregiver can see your location."
                    : "SafeZone will give you a gentle reminder while you contact your caregiver."
            )
            .font(.footnote)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)

            if helpRequested {
                Button("Done") { dismiss() }
                    .buttonStyle(.bordered)
            } else {
                Button("Request help", action: onRequestHelp)
                    .buttonStyle(.borderedProminent)
                    .tint(SafeZoneTheme.caution)
            }
        }
        .padding()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(helpRequested ? "Help requested for \(patientName)" : "Request help for \(patientName)")
    }
}
