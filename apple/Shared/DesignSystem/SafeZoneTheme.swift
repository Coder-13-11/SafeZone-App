import SwiftUI

enum SafeZoneTheme {
    static let background = Color("SafeZoneBackground")
    static let card = Color("SafeZoneCard")
    static let safe = Color(red: 0.39, green: 0.73, blue: 0.54)
    static let caution = Color(red: 0.95, green: 0.65, blue: 0.25)
    static let alert = Color(red: 0.92, green: 0.30, blue: 0.25)
    static let unavailable = Color.secondary

    static func color(for state: SafetyState) -> Color {
        switch state {
        case .safe: safe
        case .caution, .grace: caution
        case .alert: alert
        case .unknown: unavailable
        }
    }
}

struct SafeZoneCardModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white)
                    .shadow(
                        color: Color.black.opacity(colorScheme == .dark ? 0.12 : 0.06),
                        radius: 18,
                        y: 8
                    )
            )
    }
}

extension View {
    func safeZoneCard() -> some View {
        modifier(SafeZoneCardModifier())
    }
}
