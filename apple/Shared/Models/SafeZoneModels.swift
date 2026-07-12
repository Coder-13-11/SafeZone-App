import Foundation
import CoreLocation

enum SafetyState: String, Codable, Sendable {
    case unknown
    case safe
    case caution
    case grace
    case alert

    var title: String {
        switch self {
        case .safe: "Safe"
        case .caution: "Approaching"
        case .grace: "Checking"
        case .alert: "Alert"
        case .unknown: "Unavailable"
        }
    }

    func message(patientName: String, zoneName: String = "Home Zone") -> String {
        switch self {
        case .safe: "\(patientName) is inside \(zoneName)"
        case .caution: "\(patientName) is approaching the boundary"
        case .grace: "Checking whether \(patientName) left \(zoneName)"
        case .alert: "\(patientName) has left \(zoneName)"
        case .unknown: "Location temporarily unavailable"
        }
    }

    var requiresAction: Bool {
        self == .alert
    }
}

struct CoordinatePoint: Codable, Hashable, Sendable {
    let lat: Double
    let lng: Double

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

struct SafeZone: Codable, Identifiable, Sendable {
    let id: String
    let householdId: String?
    let name: String
    let color: String
    let points: [CoordinatePoint]
    let isActive: Bool
}

struct LocationPing: Codable, Identifiable, Sendable {
    let id: String
    let householdId: String
    let lat: Double
    let lng: Double
    let accuracy: Double?
    let timestamp: Date
    let battery: Double?
    let stateAtTime: SafetyState
    let zoneId: String?
    let distanceToBoundaryM: Double?
    let graceEndsAt: Date?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

struct CaregiverPresence: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let label: String
}

struct CareResponse: Codable, Identifiable, Sendable {
    enum Status: String, Codable, Sendable {
        case responding
        case helpRequested = "help_requested"
    }

    let id: String
    let caregiverLabel: String
    let status: Status
    let timestamp: Date
}

struct ZoneResponse: Codable, Sendable {
    let zones: [SafeZone]
}

struct HistoryResponse: Codable, Sendable {
    let history: [LocationPing]
}

enum LiveMessage: Decodable, Sendable {
    case hello(zones: [SafeZone])
    case zones([SafeZone])
    case location(LocationPing)
    case stateChange(SafetyState)
    case presence([CaregiverPresence])
    case careResponse(CareResponse?)

    private enum CodingKeys: String, CodingKey {
        case type, zones, viewers, state, response
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "hello":
            self = .hello(zones: try container.decode([SafeZone].self, forKey: .zones))
        case "zones":
            self = .zones(try container.decode([SafeZone].self, forKey: .zones))
        case "location":
            self = .location(try LocationPing(from: decoder))
        case "state_change":
            self = .stateChange(try container.decode(SafetyState.self, forKey: .state))
        case "presence":
            self = .presence(try container.decode([CaregiverPresence].self, forKey: .viewers))
        case "care_response":
            self = .careResponse(try container.decodeIfPresent(CareResponse.self, forKey: .response))
        default:
            self = .stateChange(.unknown)
        }
    }
}
