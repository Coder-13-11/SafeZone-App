import SwiftUI

@main
struct SafeZoneApp: App {
    var body: some Scene {
        WindowGroup {
            CaregiverHomeView()
                .tint(SafeZoneTheme.safe)
        }
    }
}
