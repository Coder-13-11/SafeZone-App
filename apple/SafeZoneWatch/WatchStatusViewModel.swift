import Foundation
import SwiftUI
import WatchKit

@MainActor
final class WatchStatusViewModel: ObservableObject {
    @Published private(set) var ping: LocationPing?
    @Published private(set) var connection: ConnectionStatus = .connecting
    @Published private(set) var helpRequested = false

    let patientName: String
    private let client: SafeZoneAPIClient
    private var liveTask: Task<Void, Never>?
    private var previousState: SafetyState = .unknown

    init(
        patientName: String = "Loved One",
        client: SafeZoneAPIClient = SafeZoneAPIClient()
    ) {
        self.patientName = patientName
        self.client = client
    }

    var state: SafetyState {
        guard let ping, Date.now.timeIntervalSince(ping.timestamp) <= 60 else {
            return .unknown
        }
        return ping.stateAtTime
    }

    func start() async {
        guard liveTask == nil else { return }

        if let latest = (try? await client.fetchHistory())?.last {
            receive(latest)
        }

        liveTask = Task { [weak self] in
            guard let self else { return }
            do {
                let messages = try await client.liveMessages(caregiverLabel: "Apple Watch")
                connection = .live
                for try await message in messages {
                    if case .location(let ping) = message {
                        receive(ping)
                    }
                }
            } catch {
                guard !Task.isCancelled else { return }
                connection = .unavailable
            }
        }
    }

    func stop() {
        liveTask?.cancel()
        liveTask = nil
        Task { await client.disconnect() }
    }

    func requestHelp() {
        Task {
            do {
                _ = try await client.sendCareResponse(
                    action: "request_help",
                    caregiverLabel: patientName
                )
                helpRequested = true
                WKInterfaceDevice.current().play(.notification)
            } catch {
                connection = .unavailable
                WKInterfaceDevice.current().play(.failure)
            }
        }
    }

    private func receive(_ newPing: LocationPing) {
        ping = newPing
        let newState = newPing.stateAtTime

        guard newState != previousState else { return }
        switch newState {
        case .safe:
            if previousState == .alert || previousState == .grace {
                WKInterfaceDevice.current().play(.success)
            }
        case .caution:
            WKInterfaceDevice.current().play(.directionUp)
        case .alert:
            WKInterfaceDevice.current().play(.notification)
        case .grace, .unknown:
            break
        }
        previousState = newState
    }
}
