import type { ReactNode } from "react";
import { SafeZoneMark } from "./WelcomeView";
import { caregiverHref } from "../safetyLanguage";

export type DashboardView = "overview" | "map" | "activity" | "family" | "settings";

const navigation: Array<{ id: DashboardView; label: string; symbol: string }> = [
  { id: "overview", label: "Overview", symbol: "⌂" },
  { id: "map", label: "Live Map", symbol: "◎" },
  { id: "activity", label: "Activity", symbol: "↗" },
  { id: "family", label: "Care circle", symbol: "♧" },
  { id: "settings", label: "Settings", symbol: "⚙" }
];

export function DashboardShell({
  activeView,
  caregiverName,
  patientName,
  connected,
  demoMode,
  householdId,
  children
}: {
  activeView: DashboardView;
  caregiverName: string;
  patientName: string;
  connected: boolean;
  demoMode?: boolean;
  householdId?: string;
  children: ReactNode;
}) {
  const titles: Record<DashboardView, { eyebrow: string; title: string }> = {
    overview: { eyebrow: caregiverName ? `Welcome back, ${caregiverName}` : "Welcome back", title: `${patientName} at a glance` },
    map: { eyebrow: "Live location", title: `Where ${patientName} is now` },
    activity: { eyebrow: "Care history", title: "Emergency timeline" },
    family: { eyebrow: "Shared care", title: "Your care circle" },
    settings: { eyebrow: "Preferences", title: "SafeZone settings" }
  };

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-rail">
        <a href="/" className="dashboard-brand"><SafeZoneMark /><span>SafeZone</span></a>
        <nav aria-label="Caregiver dashboard">
          {navigation.map((item) => (
            <a
              key={item.id}
              href={caregiverHref(item.id === "overview" ? undefined : item.id, demoMode, householdId)}
              className={activeView === item.id ? "active" : ""}
              aria-current={activeView === item.id ? "page" : undefined}
            >
              <span aria-hidden="true">{item.symbol}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="rail-patient">
          <span className="rail-avatar">
            {patientName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
          </span>
          <div><small>Care profile</small><strong>{patientName}</strong></div>
          <i className={connected ? "online" : ""} aria-label={connected ? "Dashboard connected" : "Dashboard reconnecting"} />
        </div>
      </aside>

      <section className="dashboard-workspace">
        <header className="dashboard-header">
          <div>
            <p>{titles[activeView].eyebrow}</p>
            <h1>{titles[activeView].title}</h1>
          </div>
          <div className="header-actions">
            <span className={`header-connection ${connected ? "connected" : ""}`}>
              <i /> {connected ? "Dashboard online" : "Reconnecting"}
            </span>
            <a href={caregiverHref("family", demoMode, householdId)} className="add-family-button">Care circle</a>
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
