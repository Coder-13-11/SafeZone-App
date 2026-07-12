import Foundation

actor SafeZoneAPIClient {
    private struct CareResponseEnvelope: Decodable {
        let response: CareResponse?
    }

    enum ClientError: LocalizedError {
        case invalidURL
        case invalidResponse

        var errorDescription: String? {
            switch self {
            case .invalidURL: "SafeZone could not create the server address."
            case .invalidResponse: "SafeZone received an unexpected server response."
            }
        }
    }

    private let baseURL: URL
    private let householdId: String
    private let session: URLSession
    private let decoder: JSONDecoder
    private var socket: URLSessionWebSocketTask?

    init(
        baseURL: URL = URL(string: "http://localhost:4173")!,
        householdId: String = "demo-household",
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.householdId = householdId
        self.session = session

        let decoder = JSONDecoder()
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standardFormatter = ISO8601DateFormatter()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = fractionalFormatter.date(from: value) ?? standardFormatter.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO-8601 date: \(value)"
            )
        }
        self.decoder = decoder
    }

    func fetchZones() async throws -> [SafeZone] {
        let url = try endpoint("/api/zones", query: ["householdId": householdId])
        let response: ZoneResponse = try await request(url)
        return response.zones
    }

    func fetchHistory(since: Date? = nil) async throws -> [LocationPing] {
        var query = ["householdId": householdId]
        if let since {
            query["since"] = ISO8601DateFormatter().string(from: since)
        }

        let url = try endpoint("/api/history", query: query)
        let response: HistoryResponse = try await request(url)
        return response.history
    }

    func liveMessages(caregiverLabel: String) throws -> AsyncThrowingStream<LiveMessage, Error> {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw ClientError.invalidURL
        }

        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws"
        components.queryItems = [
            URLQueryItem(name: "householdId", value: householdId),
            URLQueryItem(name: "role", value: "caregiver"),
            URLQueryItem(name: "label", value: caregiverLabel)
        ]

        guard let url = components.url else {
            throw ClientError.invalidURL
        }

        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()

        return AsyncThrowingStream { continuation in
            let receiveTask = Task {
                do {
                    while !Task.isCancelled {
                        let message = try await task.receive()
                        let data: Data

                        switch message {
                        case .data(let value):
                            data = value
                        case .string(let value):
                            data = Data(value.utf8)
                        @unknown default:
                            continue
                        }

                        continuation.yield(try decoder.decode(LiveMessage.self, from: data))
                    }
                } catch {
                    if !Task.isCancelled {
                        continuation.finish(throwing: error)
                    }
                }
            }

            continuation.onTermination = { _ in
                receiveTask.cancel()
                task.cancel(with: .goingAway, reason: nil)
            }
        }
    }

    func sendCareResponse(action: String, caregiverLabel: String) async throws -> CareResponse? {
        let url = try endpoint("/api/respond", query: [:])
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "householdId": householdId,
            "caregiverLabel": caregiverLabel,
            "action": action
        ])

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              200..<300 ~= httpResponse.statusCode else {
            throw ClientError.invalidResponse
        }

        return try decoder.decode(CareResponseEnvelope.self, from: data).response
    }

    func disconnect() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    private func endpoint(_ path: String, query: [String: String]) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw ClientError.invalidURL
        }

        components.path = path
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }

        guard let url = components.url else {
            throw ClientError.invalidURL
        }

        return url
    }

    private func request<Response: Decodable>(_ url: URL) async throws -> Response {
        let (data, response) = try await session.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              200..<300 ~= httpResponse.statusCode else {
            throw ClientError.invalidResponse
        }

        return try decoder.decode(Response.self, from: data)
    }
}
