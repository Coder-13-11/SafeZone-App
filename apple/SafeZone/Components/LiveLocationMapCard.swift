import SwiftUI
import MapKit

struct LiveLocationMapCard: View {
    let patientName: String
    let latestPing: LocationPing?
    let history: [LocationPing]
    let zones: [SafeZone]

    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
            span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)
        )
    )

    private var recentTrail: [CLLocationCoordinate2D] {
        history.suffix(80).map(\.coordinate)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("LOCATION")
                        .font(.caption2.weight(.semibold))
                        .tracking(0.8)
                        .foregroundStyle(.secondary)
                    Text("Live map")
                        .font(.title2.bold())
                }
                Spacer()
                Label("Accuracy shown", systemImage: "scope")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Map(position: $position, interactionModes: [.pan, .zoom, .rotate]) {
                ForEach(zones.filter(\.isActive)) { zone in
                    MapPolygon(coordinates: zone.points.map(\.coordinate))
                        .foregroundStyle(SafeZoneTheme.safe.opacity(0.15))
                        .stroke(SafeZoneTheme.safe, lineWidth: 2)
                }

                if recentTrail.count > 1 {
                    MapPolyline(coordinates: recentTrail)
                        .stroke(.white.opacity(0.7), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                }

                if let latestPing {
                    if let accuracy = latestPing.accuracy {
                        MapCircle(center: latestPing.coordinate, radius: accuracy)
                            .foregroundStyle(SafeZoneTheme.safe.opacity(0.12))
                            .stroke(SafeZoneTheme.safe.opacity(0.5), lineWidth: 1)
                    }

                    Annotation(patientName, coordinate: latestPing.coordinate, anchor: .center) {
                        ZStack {
                            Circle()
                                .fill(SafeZoneTheme.color(for: latestPing.stateAtTime))
                                .frame(width: 30, height: 30)
                            Circle()
                                .stroke(.white, lineWidth: 4)
                                .frame(width: 30, height: 30)
                            if let heading {
                                Image(systemName: "location.north.fill")
                                    .font(.caption2.bold())
                                    .foregroundStyle(.white)
                                    .rotationEffect(.degrees(heading))
                                    .offset(y: -22)
                            }
                        }
                        .shadow(radius: 8)
                        .accessibilityLabel("\(patientName)’s current location")
                    }
                }
            }
            .mapStyle(.standard(elevation: .realistic))
            .frame(minHeight: 320)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                if let latestPing {
                    Text(latestPing.accuracy.map { "Location accurate to about \(Int($0.rounded())) m" } ?? "Accuracy unavailable")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.regularMaterial, in: Capsule())
                        .padding(12)
                }
            }
        }
        .safeZoneCard()
        .onAppear(perform: centerOnPatient)
        .onChange(of: latestPing?.id) {
            centerOnPatient()
        }
    }

    private var heading: Double? {
        guard history.count >= 2 else { return nil }
        let start = history[history.count - 2].coordinate
        let end = history[history.count - 1].coordinate
        let deltaLongitude = end.longitude - start.longitude
        let deltaLatitude = end.latitude - start.latitude
        guard abs(deltaLongitude) + abs(deltaLatitude) > 0.000001 else { return nil }
        return atan2(deltaLongitude, deltaLatitude) * 180 / .pi
    }

    private func centerOnPatient() {
        guard let coordinate = latestPing?.coordinate else { return }
        withAnimation(.easeInOut(duration: 0.6)) {
            position = .region(
                MKCoordinateRegion(
                    center: coordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.006, longitudeDelta: 0.006)
                )
            )
        }
    }
}
