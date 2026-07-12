import SwiftUI

@main
struct SafeZoneWatchApp: App {
    var body: some Scene {
        WindowGroup {
            WatchStatusView()
                .tint(SafeZoneTheme.safe)
        }
    }
}
