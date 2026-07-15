import type { GeofenceState } from "./types";

export const ESCALATION_LADDER = [
  "Safe",
  "Near Boundary",
  "Confirming Exit",
  "Needs Attention",
  "Family Responding",
  "Resolved"
] as const;

export const STATE_CHIP_LABEL: Record<GeofenceState, string> = {
  safe: "Safe",
  caution: "Near Boundary",
  grace: "Confirming Exit",
  alert: "Needs Attention",
  unknown: "Setting Up"
};

export const STATE_TIMELINE_LABEL: Record<GeofenceState, string> = {
  safe: "Inside Home Zone",
  caution: "Near boundary",
  grace: "Confirming exit",
  alert: "Left Home Zone — needs attention",
  unknown: "Location became available"
};

export function caregiverHref(view?: string, demoMode = false, householdId?: string) {
  const params = new URLSearchParams();
  if (demoMode) params.set("demo", "1");
  if (householdId && householdId !== "demo-household") params.set("household", householdId);
  if (view && view !== "overview") params.set("view", view);
  const query = params.toString();
  return `/caregiver${query ? `?${query}` : ""}`;
}

export function familyInviteUrl(householdId: string, demoMode = false) {
  const base = import.meta.env.VITE_PUBLIC_URL || window.location.origin;
  const params = new URLSearchParams();
  if (demoMode) {
    params.set("demo", "1");
    params.set("view", "family");
  } else {
    params.set("household", householdId);
    params.set("view", "family");
  }
  return `${base}/caregiver?${params.toString()}`;
}
