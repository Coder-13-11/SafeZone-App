import type { GeofenceState, LocationPing } from "./types";
import { STATE_CHIP_LABEL } from "./safetyLanguage";

export type ConnectionState = "connecting" | "live" | "offline";
export type CareConfidenceLevel = "excellent" | "good" | "attention" | "critical";

export type CareConfidence = {
  score: number;
  level: CareConfidenceLevel;
  label: string;
  summary: string;
  details: Array<{
    label: string;
    value: string;
    healthy: boolean;
  }>;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function relativeUpdate(timestamp: string | null) {
  if (!timestamp) {
    return "No location yet";
  }

  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds} sec ago`;

  const minutes = Math.round(seconds / 60);
  return `${minutes} min ago`;
}

export function calculateCareConfidence(
  ping: LocationPing | null,
  connection: ConnectionState,
  state: GeofenceState,
  now = Date.now()
): CareConfidence {
  if (!ping) {
    return {
      score: 0,
      level: "attention",
      label: "Location unavailable",
      summary: "Open SafeZone on the patient phone and allow location access.",
      details: [
        { label: "Location", value: "Not available", healthy: false },
        { label: "Connection", value: connection === "live" ? "Connected" : "Not connected", healthy: false }
      ]
    };
  }

  const ageSeconds = Math.max(0, (now - Date.parse(ping.timestamp)) / 1000);
  const accuracy = ping.accuracy ?? 100;
  const battery = ping.battery;
  let score = 100;

  if (connection !== "live") score -= 35;
  if (ageSeconds > 120) score -= 40;
  else if (ageSeconds > 60) score -= 25;
  else if (ageSeconds > 20) score -= 10;

  if (accuracy > 80) score -= 25;
  else if (accuracy > 35) score -= 15;
  else if (accuracy > 15) score -= 7;

  if (battery !== null && battery < 10) score -= 25;
  else if (battery !== null && battery < 25) score -= 10;

  if (state === "alert") score -= 35;
  else if (state === "grace") score -= 20;
  else if (state === "caution") score -= 8;

  score = clamp(score);

  const level: CareConfidenceLevel =
    score >= 90 ? "excellent" : score >= 70 ? "good" : score >= 40 ? "attention" : "critical";
  const label =
    level === "excellent"
      ? "High confidence"
      : level === "good"
        ? "Reliable enough to act"
        : level === "attention"
          ? "Check tracking"
          : "Status uncertain";
  const summary =
    level === "excellent"
      ? "Location is recent, clear, and reporting normally."
      : level === "good"
        ? "The current location is usable, but one signal is less reliable."
        : level === "attention"
          ? "Open details to see what needs attention."
          : "Do not rely on the current status until the patient phone reconnects.";

  return {
    score,
    level,
    label,
    summary,
    details: [
      {
        label: "GPS",
        value: ping.accuracy ? (accuracy <= 12 ? "Strong" : accuracy <= 35 ? "Good" : "Approximate") : "Unknown",
        healthy: accuracy <= 35
      },
      {
        label: "Freshness",
        value: relativeUpdate(ping.timestamp),
        healthy: ageSeconds <= 60
      },
      {
        label: "Accuracy",
        value: ping.accuracy ? `±${Math.round(ping.accuracy)} m` : "Unknown",
        healthy: accuracy <= 35
      },
      {
        label: "Internet",
        value: connection === "live" ? "Stable" : "Reconnecting",
        healthy: connection === "live"
      },
      {
        label: "Battery",
        value: battery === null ? "Unavailable" : `${battery}%`,
        healthy: battery === null || battery >= 25
      },
      {
        label: "Safety state",
        value: STATE_CHIP_LABEL[state],
        healthy: state === "safe"
      }
    ]
  };
}
