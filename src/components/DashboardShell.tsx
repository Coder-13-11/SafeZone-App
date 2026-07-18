import type { ReactNode } from "react";
import { NavoraMark } from "./WelcomeView";
import { caregiverHref } from "../safetyLanguage";

export type DashboardView = "overview" | "map" | "activity" | "family" | "settings";

function NavIcon({ view }: { view: DashboardView }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  switch (view) {
    case "overview":
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5" />
          <path d="M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <circle cx="12" cy="11" r="3" />
          <path d="M12 21c4-4.2 7-7.2 7-10.2A7 7 0 0 0 5 10.8C5 13.8 8 16.8 12 21Z" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "family":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3" />
          <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S13.9 16 14.5 19" />
          <circle cx="16.5" cy="10" r="2.4" />
          <path d="M15.5 14.6c2.4.1 4.3 1.5 4.9 4.4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="6" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

const navigation: Array<{ id: DashboardView; label: string }> = [
  { id: "overview", label: "Home" },
  { id: "map", label: "Map" },
  { id: "activity", label: "Activity" },
  { id: "family", label: "Family" },
  { id: "settings", label: "More" }
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
    overview: {
      eyebrow: caregiverName ? `Welcome back, ${caregiverName}` : "Welcome back",
      title: "Home"
    },
    map: { eyebrow: "Live location", title: `Where ${patientName || "they"} ${patientName ? "is" : "are"} now` },
    activity: { eyebrow: "Care history", title: "Recent activity" },
    family: { eyebrow: "Shared care", title: "Your family" },
    settings: { eyebrow: "Preferences", title: "More" }
  };

  const initials =
    patientName
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2) || "–";

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-rail">
        <a href="/" className="brand-lockup rail-brand"><NavoraMark /><span>Navora</span></a>
        <nav className="rail-nav" aria-label="Caregiver dashboard">
          {navigation.map((item) => (
            <a
              key={item.id}
              href={caregiverHref(item.id === "overview" ? undefined : item.id, demoMode, householdId)}
              className={activeView === item.id ? "active" : ""}
              aria-current={activeView === item.id ? "page" : undefined}
            >
              <NavIcon view={item.id} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="rail-patient">
          <span className="rail-avatar" aria-hidden="true">{initials}</span>
          <div>
            <small>Caring for</small>
            <strong>{patientName || "Your loved one"}</strong>
          </div>
          <i className={connected ? "online" : ""} aria-label={connected ? "Dashboard connected" : "Dashboard reconnecting"} />
        </div>
      </aside>

      <section className="dashboard-workspace">
        <header className="dashboard-header">
          <div>
            <p>{titles[activeView].eyebrow}</p>
            <h1>{titles[activeView].title}</h1>
          </div>
          <span className={`connection-pill ${connected ? "connected" : ""}`}>
            <i aria-hidden="true" /> {connected ? "Live" : "Reconnecting"}
          </span>
        </header>
        <div className="dashboard-content">{children}</div>
      </section>
    </main>
  );
}
