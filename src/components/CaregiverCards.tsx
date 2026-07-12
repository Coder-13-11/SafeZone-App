import type { CSSProperties } from "react";
import type { CareConfidence } from "../careConfidence";
import type { CareResponse, GeofenceState, LocationPing, PresenceViewer } from "../types";

type SafetyPresentation = {
  eyebrow: string;
  headline: string;
  detail: string;
  reassurance: string;
};

export function SafetyHeroCard({
  patientName,
  presentation,
  state,
  connection,
  connectionLabel,
  updatedLabel,
  accuracyM,
  graceEndsAt,
  response,
  onRespond
}: {
  patientName: string;
  presentation: SafetyPresentation;
  state: GeofenceState;
  connection: "connecting" | "live" | "offline";
  connectionLabel?: string;
  updatedLabel: string;
  accuracyM: number | null;
  graceEndsAt: string | null;
  response: CareResponse | null;
  onRespond: () => void;
}) {
  return (
    <section
      className={`safety-hero state-${state}`}
      aria-labelledby="patient-safety-heading"
      aria-live={state === "alert" ? "assertive" : "polite"}
    >
      <div className="patient-identity">
        <div className="patient-photo" aria-hidden="true">
          {patientName
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)}
        </div>
        <div>
          <span>Loved one</span>
          <strong>{patientName}</strong>
        </div>
        <span className={`connection-dot ${connection}`}>
          {connectionLabel ||
            (connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Unavailable")}
        </span>
      </div>

      <div className="safety-state-lockup">
        <span className="safety-symbol" aria-hidden="true">
          {state === "safe" ? "✓" : state === "alert" ? "!" : state === "caution" || state === "grace" ? "…" : "–"}
        </span>
        <div>
          <p className="eyebrow">{presentation.eyebrow}</p>
          <h1 id="patient-safety-heading">{presentation.headline}</h1>
        </div>
      </div>

      <p className="lede">{presentation.detail}</p>
      <div className="hero-footer">
        <strong>{presentation.reassurance}</strong>
        <span className={accuracyM !== null && accuracyM > 35 ? "approximate-location" : ""}>
          {updatedLabel}
          {accuracyM !== null ? ` · GPS accuracy about ${Math.round(accuracyM)} m` : ""}
          {accuracyM !== null && accuracyM > 35 ? " — location is approximate" : ""}
        </span>
      </div>
      {state === "grace" && graceEndsAt ? (
        <p className="grace-countdown">
          Confirmed alert in approximately {Math.max(0, Math.ceil((Date.parse(graceEndsAt) - Date.now()) / 1000))} seconds unless a new location returns inside Home Zone.
        </p>
      ) : null}
      {state === "alert" ? (
        <div className="safety-next-actions">
          <p>What to do now</p>
          <div>
            <a href="/caregiver?view=map">View last known location</a>
            {response ? (
              <span className="response-in-progress">
                ✓ {response.caregiverLabel} {response.status === "help_requested" ? "requested help" : "is responding"}
              </span>
            ) : (
              <button type="button" onClick={onRespond}>I’m responding</button>
            )}
          </div>
          <small>If there may be immediate danger, contact local emergency services. SafeZone does not dispatch help.</small>
        </div>
      ) : state === "caution" || state === "grace" ? (
        <a className="safety-map-link" href="/caregiver?view=map">Watch live location <span>→</span></a>
      ) : state === "unknown" ? (
        <a
          className="safety-map-link"
          href={presentation.headline.includes("Home Zone") ? "/caregiver?view=map" : "/caregiver?view=family"}
        >
          {presentation.headline.includes("Home Zone") ? "Set Home Zone" : "Check patient device"} <span>→</span>
        </a>
      ) : null}
    </section>
  );
}

export function CareConfidenceCard({
  confidence,
  expanded,
  onToggle
}: {
  confidence: CareConfidence;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <section className={`confidence-card confidence-${confidence.level}`}>
      <button
        type="button"
        className="confidence-summary"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="confidence-details"
      >
        <span className="confidence-ring" style={{ "--confidence": confidence.score } as CSSProperties}>
          <strong>{confidence.level === "excellent" || confidence.level === "good" ? "✓" : "!"}</strong>
        </span>
        <span className="confidence-copy">
          <small>Tracking health</small>
          <strong>{confidence.label}</strong>
          <span>{confidence.summary}</span>
        </span>
        <span className="disclosure" aria-hidden="true">
          {expanded ? "−" : "+"}
        </span>
      </button>

      {expanded ? (
        <div id="confidence-details" className="confidence-details">
          {confidence.details.map((detail) => (
            <div key={detail.label}>
              <span className={detail.healthy ? "detail-health healthy" : "detail-health"} aria-hidden="true" />
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function HumanTimeline({ history }: { history: LocationPing[] }) {
  const events = history
    .filter((ping, index) => index === 0 || ping.stateAtTime !== history[index - 1].stateAtTime)
    .slice(-4)
    .reverse();

  return (
    <section className="content-card timeline-card">
      <div className="section-heading">
        <div>
          <span>Today</span>
          <h2>Recent activity</h2>
        </div>
        <span className="section-icon" aria-hidden="true">
          ↗
        </span>
      </div>
      {events.length === 0 ? (
        <p className="empty-copy">Activity will appear after the patient device begins sharing its location.</p>
      ) : (
        <ol className="human-timeline">
          {events.map((ping) => (
            <li key={ping.id}>
              <time dateTime={ping.timestamp}>
                {new Date(ping.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time>
              <span className={`timeline-dot state-${ping.stateAtTime}`} aria-hidden="true" />
              <div>
                <strong>
                  {ping.stateAtTime === "safe"
                    ? "Inside Home Zone"
                    : ping.stateAtTime === "caution"
                      ? "Approached the boundary"
                      : ping.stateAtTime === "alert"
                        ? "Left Home Zone"
                        : ping.stateAtTime === "grace"
                          ? "Boundary crossing detected"
                          : "Location became available"}
                </strong>
                <span>{ping.accuracy ? `Location within about ${Math.round(ping.accuracy)} m` : "Location received"}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function FamilyCoordinationCard({
  viewers,
  currentCaregiver,
  alertActive,
  response,
  onRespond
}: {
  viewers: PresenceViewer[];
  currentCaregiver: string;
  alertActive: boolean;
  response: CareResponse | null;
  onRespond: () => void;
}) {
  const family = viewers.length > 0 ? viewers : [{ id: "self", label: currentCaregiver }];

  return (
    <section className="content-card family-card">
      <div className="section-heading">
        <div>
          <span>Family</span>
          <h2>Care team</h2>
        </div>
        <span className="family-count">{family.length}</span>
      </div>
      <ul>
        {family.slice(0, 4).map((viewer) => (
          <li key={viewer.id}>
            <span className="family-avatar" aria-hidden="true">
              {viewer.label[0]?.toUpperCase() || "C"}
            </span>
            <div>
              <strong>{viewer.label}</strong>
              <span>{viewer.label === currentCaregiver ? "You’re currently viewing" : "Currently viewing"}</span>
            </div>
            <span className="presence-light" aria-label="Online" />
          </li>
        ))}
      </ul>
      {response ? (
        <p className={`care-response ${response.status}`}>
          <strong>
            {response.status === "help_requested"
              ? `${response.caregiverLabel} requested help`
              : `${response.caregiverLabel} is responding`}
          </strong>
          <span>{new Date(response.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </p>
      ) : alertActive ? (
        <button type="button" className="respond-button" onClick={onRespond}>
          I’m responding
        </button>
      ) : null}
    </section>
  );
}
