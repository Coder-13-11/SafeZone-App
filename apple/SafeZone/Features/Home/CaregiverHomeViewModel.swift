import Foundation
import SwiftUI

@MainActor
final class CaregiverHomeViewModel: ObservableObject {
    struct TimelineEvent: Identifiable {
        let id: String
        let date: Date
        let title: String
        let detail: String
        let state: SafetyState
    }

    @Published private(set) var latestPing: LocationPing?
    @Published private(set) var zones: [SafeZone] = []
    @Published private(set) var history: [LocationPing] = []
    @Published private(set) var caregivers: [CaregiverPresence] = []
    @Published private(set) var careResponse: CareResponse?
    @Published private(set) var connection: ConnectionStatus = .connecting
    @Published private(set) var errorMessage: String?

    let patientName: String
    let caregiverName: String

    private let client: SafeZoneAPIClient
    private var liveTask: Task<Void, Never>?

    init(
        patientName: String = "Loved One",
        caregiverName: String = "Caregiver",
        client: SafeZoneAPIClient = SafeZoneAPIClient()
    ) {
        self.patientName = patientName
        self.caregiverName = caregiverName
        self.client = client
    }

    var safetyState: SafetyState {
        guard let latestPing else { return .unknown }
        if Date.now.timeIntervalSince(latestPing.timestamp) > 60 { return .unknown }
        return latestPing.stateAtTime
    }

    var confidence: CareConfidence {
        CareConfidence.evaluate(ping: latestPing, connection: connection)
    }

    var activeZoneName: String {
        zones.first(where: \.isActive)?.name ?? "Home Zone"
    }

    var respondingCaregiverId: String? {
        careResponse?.id
    }

    var timeline: [TimelineEvent] {
        history.enumerated()
            .filter { index, ping in
                index == 0 || ping.stateAtTime != history[index - 1].stateAtTime
            }
            .suffix(5)
            .reversed()
            .map { _, ping in
                TimelineEvent(
                    id: ping.id,
                    date: ping.timestamp,
                    title: eventTitle(for: ping.stateAtTime),
                    detail: ping.accuracy.map { "Location within about \(Int($0.rounded())) m" } ?? "Location received",
                    state: ping.stateAtTime
                )
            }
    }

    func start() async {
        guard liveTask == nil else { return }

        do {
            async let loadedZones = client.fetchZones()
            async let loadedHistory = client.fetchHistory()
            zones = try await loadedZones
            history = try await loadedHistory
            latestPing = history.last
            errorMessage = nil
        } catch {
            errorMessage = "SafeZone could not load the latest information."
        }

        connection = .connecting
        liveTask = Task { [weak self] in
            guard let self else { return }
            do {
                let messages = try await client.liveMessages(caregiverLabel: caregiverName)
                connection = .live

                for try await message in messages {
                    apply(message)
                }
            } catch {
                guard !Task.isCancelled else { return }
                connection = .unavailable
                errorMessage = "Live location is temporarily unavailable."
            }
        }
    }

    func stop() {
        liveTask?.cancel()
        liveTask = nil
        Task { await client.disconnect() }
    }

    func acknowledgeAlert() {
        Task {
            do {
                careResponse = try await client.sendCareResponse(
                    action: "acknowledge",
                    caregiverLabel: caregiverName
                )
            } catch {
                errorMessage = "SafeZone could not share that you’re responding."
            }
        }
    }

    private func apply(_ message: LiveMessage) {
        switch message {
        case .hello(let newZones), .zones(let newZones):
            zones = newZones
        case .location(let ping):
            latestPing = ping
            history = Array((history + [ping]).suffix(500))
            errorMessage = nil
        case .stateChange:
            break
        case .presence(let viewers):
            caregivers = viewers
        case .careResponse(let response):
            careResponse = response
        }
    }

    private func eventTitle(for state: SafetyState) -> String {
        switch state {
        case .safe: "Inside \(activeZoneName)"
        case .caution: "Approached the boundary"
        case .grace: "Boundary crossing detected"
        case .alert: "Left \(activeZoneName)"
        case .unknown: "Location became available"
        }
    }
}
