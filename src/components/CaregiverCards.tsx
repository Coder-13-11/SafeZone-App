import { useState } from "react";
import type { CSSProperties } from "react";
import type { CareConfidence } from "../careConfidence";
import type { CareResponse, GeofenceState, LocationPing, PresenceViewer } from "../types";
import { STATE_CHIP_LABEL, STATE_TIMELINE_LABEL, caregiverHref, familyInviteUrl } from "../safetyLanguage";

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
  resolved,
  demoMode,
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
  resolved?: boolean;
  demoMode?: boolean;
  onRespond: () => void;
}) {
  const chipLabel = resolved ? "Resolved" : response && state === "alert" ? "Family Responding" : STATE_CHIP_LABEL[state];

  return (
    <section
      className={`safety-hero state-${state} ${resolved ? "state-resolved" : ""}`}
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
        <div className="patient-badges">
          <span className={`status-chip state-${resolved ? "resolved" : state}`}>{chipLabel}</span>
          <span className={`connection-dot ${connection}`}>
            {connectionLabel ||
              (connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Unavailable")}
          </span>
        </div>
      </div>

      <div className="safety-state-lockup">
        <span className="safety-symbol" aria-hidden="true">
          {resolved || state === "safe" ? "✓" : state === "alert" ? "!" : state === "caution" || state === "grace" ? "…" : "–"}
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
      {resolved ? (
        <p className="resolved-banner">Returning to safe zone — family notified that {patientName} is back inside Home Zone.</p>
      ) : null}
      {state === "alert" && !resolved ? (
        <div className="safety-next-actions">
          <p>What to do now</p>
          <div>
            <a href={caregiverHref("map", demoMode)}>View last known location</a>
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
        <a className="safety-map-link" href={caregiverHref("map", demoMode)}>Watch live location <span>→</span></a>
      ) : state === "unknown" ? (
        <a
          className="safety-map-link"
          href={caregiverHref(presentation.headline.includes("Home Zone") ? "map" : "family", demoMode)}
        >
          {presentation.headline.includes("Home Zone") ? "Set Home Zone" : "Check patient device"} <span>→</span>
        </a>
      ) : null}
    </section>
  );
}

export function TrustSignalsCard({
  ping,
  connection,
  connectionLabel
}: {
  ping: LocationPing | null;
  connection: "connecting" | "live" | "offline";
  connectionLabel?: string;
}) {
  const ageSeconds = ping ? Math.max(0, Math.round((Date.now() - Date.parse(ping.timestamp)) / 1000)) : null;
  const accuracy = ping?.accuracy ?? null;
  const battery = ping?.battery ?? null;

  const gpsLabel =
    !ping ? "Waiting" : accuracy !== null && accuracy <= 12 ? "Excellent" : accuracy !== null && accuracy <= 35 ? "Good" : "Approximate";
  const internetLabel =
    connectionLabel === "Stale · Last known"
      ? "Stale"
      : connection === "live"
        ? "Strong"
        : connection === "connecting"
          ? "Connecting"
          : "Offline";

  return (
    <section className="trust-signals-card" aria-label="Tracking status">
      <div className="section-heading">
        <div>
          <span>Trust</span>
          <h2>Tracking status</h2>
        </div>
      </div>
      <div className="trust-grid">
        <div className={gpsLabel === "Excellent" || gpsLabel === "Good" ? "trust-good" : ""}>
          <small>GPS</small>
          <strong>{gpsLabel}</strong>
        </div>
        <div>
          <small>Accuracy</small>
          <strong>{accuracy !== null ? `±${Math.round(accuracy)}m` : "—"}</strong>
        </div>
        <div className={ageSeconds !== null && ageSeconds <= 60 ? "trust-good" : ageSeconds !== null && ageSeconds > 60 ? "trust-warn" : ""}>
          <small>Last update</small>
          <strong>
            {ageSeconds === null
              ? "Waiting"
              : ageSeconds < 10
                ? "Just now"
                : ageSeconds < 60
                  ? `${ageSeconds} sec ago`
                  : `${Math.round(ageSeconds / 60)} min ago`}
          </strong>
        </div>
        <div className={battery !== null && battery >= 25 ? "trust-good" : battery !== null ? "trust-warn" : ""}>
          <small>Battery</small>
          <strong>{battery !== null ? `${battery}%` : "—"}</strong>
        </div>
        <div className={internetLabel === "Strong" ? "trust-good" : internetLabel === "Stale" || internetLabel === "Offline" ? "trust-warn" : ""}>
          <small>Internet</small>
          <strong>{internetLabel}</strong>
        </div>
      </div>
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
          <strong>{confidence.score}%</strong>
        </span>
        <span className="confidence-copy">
          <small>Confidence</small>
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

export function HumanTimeline({ history, response }: { history: LocationPing[]; response?: CareResponse | null }) {
  const events = history
    .filter((ping, index) => index === 0 || ping.stateAtTime !== history[index - 1].stateAtTime)
    .slice(-4)
    .reverse();

  const showResponse = response && events.some((ping) => ping.stateAtTime === "alert");

  return (
    <section className="content-card timeline-card">
      <div className="section-heading">
        <div>
          <span>Today</span>
          <h2>Emergency timeline</h2>
        </div>
        <span className="section-icon" aria-hidden="true">
          ↗
        </span>
      </div>
      {events.length === 0 ? (
        <p className="empty-copy">Activity will appear after the patient device begins sharing its location.</p>
      ) : (
        <ol className="human-timeline">
          {events.map((ping, index) => (
            <li key={ping.id} className="timeline-enter" style={{ animationDelay: `${index * 80}ms` }}>
              <time dateTime={ping.timestamp}>
                {new Date(ping.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time>
              <span className={`timeline-dot state-${ping.stateAtTime}`} aria-hidden="true" />
              <div>
                <strong>{STATE_TIMELINE_LABEL[ping.stateAtTime]}</strong>
                <span>{ping.accuracy ? `Location within about ${Math.round(ping.accuracy)} m` : "Location received"}</span>
              </div>
            </li>
          ))}
          {showResponse ? (
            <li className="timeline-enter timeline-response" style={{ animationDelay: `${events.length * 80}ms` }}>
              <time dateTime={response.timestamp}>
                {new Date(response.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time>
              <span className="timeline-dot state-responding" aria-hidden="true" />
              <div>
                <strong>Family responding</strong>
                <span>{response.caregiverLabel} tapped “I’m responding”</span>
              </div>
            </li>
          ) : null}
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
  householdId,
  demoMode,
  onRespond
}: {
  viewers: PresenceViewer[];
  currentCaregiver: string;
  alertActive: boolean;
  response: CareResponse | null;
  householdId?: string;
  demoMode?: boolean;
  onRespond: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const family =
    viewers.length > 0
      ? viewers
      : [{ id: "self", label: currentCaregiver }];

  const inviteUrl =
    householdId && householdId !== "demo-household"
      ? familyInviteUrl(householdId, demoMode)
      : `${window.location.origin}${caregiverHref("family", demoMode)}`;

  function viewerStatus(label: string) {
    if (response?.caregiverLabel === label) return "Responding now";
    if (label === currentCaregiver) return "You’re viewing";
    if (alertActive) return "Alert delivered";
    return "Currently viewing";
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="content-card family-card">
      <div className="section-heading">
        <div>
          <span>Family</span>
          <h2>Care team</h2>
        </div>
        <span className="family-count">{family.length}</span>
      </div>

      <div className="family-invite-strip">
        <div>
          <strong>Add family in one tap</strong>
          <span>Share this link in your family group chat. Everyone joins the same care circle.</span>
        </div>
        <button type="button" onClick={copyInvite}>{copied ? "Copied!" : "Copy invite link"}</button>
      </div>

      <ul>
        {family.slice(0, 4).map((viewer) => (
          <li key={viewer.id}>
            <span className="family-avatar" aria-hidden="true">
              {viewer.label[0]?.toUpperCase() || "C"}
            </span>
            <div>
              <strong>{viewer.label}</strong>
              <span className={`family-status-chip ${response?.caregiverLabel === viewer.label ? "responding" : ""}`}>
                {viewerStatus(viewer.label)}
              </span>
            </div>
            <span className={`presence-light ${response?.caregiverLabel === viewer.label ? "responding" : ""}`} aria-label="Online" />
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
