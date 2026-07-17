import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import L from "leaflet";
import { calculateCareConfidence } from "./careConfidence";
import {
  AlertDecisionActions,
  CareConfidenceCard,
  FamilyCoordinationCard,
  HumanTimeline,
  SafetyHeroCard,
  TrustSignalsCard
} from "./components/CaregiverCards";
import { WelcomeView } from "./components/WelcomeView";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { DashboardShell } from "./components/DashboardShell";
import type { DashboardView } from "./components/DashboardShell";
import { PatientPairingCard } from "./components/PatientPairingCard";
import { AuthGate } from "./components/AuthGate";
import { CaregiverBootstrap } from "./components/CaregiverBootstrap";
import {
  claimPairing as claimSupabasePairing,
  claimPairingByCode as claimSupabasePairingByCode,
  createOrUpdateHousehold as createOrUpdateSupabaseHousehold,
  deleteZone as deleteSupabaseZone,
  fetchCareCoordination as fetchSupabaseCareCoordination,
  fetchHistory as fetchSupabaseHistory,
  fetchZones as fetchSupabaseZones,
  getHouseholdProfile as getSupabaseHouseholdProfile,
  ingestLocation as ingestSupabaseLocation,
  saveZone as saveSupabaseZone,
  submitCareResponse as submitSupabaseCareResponse,
  subscribePush as subscribeSupabasePush,
  supabaseEnabled,
  vapidPublicKey
} from "./lib/supabase";
import { subscribeToHousehold } from "./lib/realtime";
import { STATE_CHIP_LABEL, caregiverHref } from "./safetyLanguage";
import {
  applyLocationLocally,
  createGeofenceMemory
} from "./lib/geofence";
import {
  claimLivePairing,
  createLivePairing,
  ensureLiveHousehold,
  getLiveGeofenceMemory,
  ingestLiveLocation,
  isLiveMode,
  readLiveHousehold,
  respondLive,
  saveLiveZones,
  subscribeLiveHousehold,
  writeLiveHousehold
} from "./lib/liveSession";
import type {
  BatteryManagerLike,
  CareResponse,
  CareResponseAction,
  GeofenceState,
  LatLngPoint,
  LocationPing,
  NavigatorWithBattery,
  PresenceViewer,
  ServerMessage,
  Zone
} from "./types";

const initialQuery = new URLSearchParams(window.location.search);
const liveMode = isLiveMode();
const householdId =
  initialQuery.get("household") ||
  window.localStorage.getItem("safezone-household-id") ||
  (liveMode ? ensureLiveHousehold().id : "demo-household");
const normalTiles = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const satelliteTiles =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function apiUrl(path: string) {
  return path;
}

function wsUrl(label: string, role: "caregiver" | "patient") {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?householdId=${householdId}&role=${role}&label=${encodeURIComponent(
    label
  )}`;
}

function classForState(state: GeofenceState) {
  return `state-${state}`;
}

function vibrate(pattern: VibratePattern) {
  if ("vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

/**
 * Keeps the screen awake while the patient page is tracking, so the browser
 * is never suspended mid-walk. Re-acquires the lock whenever the tab becomes
 * visible again (the OS silently releases it when the tab is hidden).
 */
function useScreenWakeLock(active: boolean) {
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    if (!active) return;
    const wakeLockApi = (
      navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!wakeLockApi) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        const lock = await wakeLockApi!.request("screen");
        if (cancelled) {
          await lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        setEngaged(true);
        lock.addEventListener("release", () => {
          sentinel = null;
          setEngaged(false);
        });
      } catch {
        setEngaged(false);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && !sentinel) {
        acquire();
      }
    }

    acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => {});
      setEngaged(false);
    };
  }, [active]);

  return engaged;
}

type QueuedPing = {
  householdId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: string;
  battery: number | null;
};

const OFFLINE_QUEUE_LIMIT = 300;

function readOfflineQueue(key: string): QueuedPing[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOfflineQueue(key: string, queue: QueuedPing[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(queue.slice(-OFFLINE_QUEUE_LIMIT)));
  } catch {
    // Storage may be full; tracking continues with live pings only.
  }
}

function isLikelyOfflineError(caught: unknown) {
  if (!navigator.onLine) return true;
  return caught instanceof Error && /fetch|network|connection|load failed|timed? ?out/i.test(caught.message);
}

function metersLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "unknown";
  }

  return `${Math.round(value)} m`;
}

function secondsSince(timestamp: string) {
  return Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 1000));
}

function freshnessLabel(ping: LocationPing | null) {
  if (!ping) {
    return "Waiting for patient device";
  }

  const seconds = secondsSince(ping.timestamp);
  if (seconds < 10) {
    return "Updated just now";
  }

  if (seconds < 60) {
    return `Updated ${seconds} seconds ago`;
  }

  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

function humanSafetyCopy(
  state: GeofenceState,
  ping: LocationPing | null,
  isStale: boolean,
  patientName: string
) {
  if (!ping) {
    return {
      eyebrow: "No location yet",
      headline: `Waiting for ${patientName}’s phone`,
      detail: "The patient phone is connected, but it has not shared a location yet.",
      reassurance: "On that phone, open Navora and allow location access."
    };
  }

  if (isStale) {
    return {
      eyebrow: "Signal is stale",
      headline: `${patientName}’s location is delayed`,
      detail: "The map shows the last location received, not necessarily where they are now.",
      reassurance: "Check that the patient phone is charged, online, and has Navora open."
    };
  }

  if (state === "alert") {
    return {
      eyebrow: STATE_CHIP_LABEL.alert,
      headline: `${patientName} needs attention — outside Home Zone`,
      detail: "Open the map to see the latest reported location, update time, and GPS accuracy.",
      reassurance: "Family was notified. Tap I’m going, I can’t, or Take over so everyone knows who is handling it."
    };
  }

  if (state === "grace") {
    return {
      eyebrow: STATE_CHIP_LABEL.grace,
      headline: `${patientName} may be leaving Home Zone`,
      detail: "Navora received a location outside Home Zone and is waiting briefly for another reading.",
      reassurance: "No confirmed alert yet — this is the confirmation step before family is notified."
    };
  }

  if (state === "caution") {
    return {
      eyebrow: STATE_CHIP_LABEL.caution,
      headline: `${patientName} is near the Home Zone boundary`,
      detail: "The latest reported location is close to the edge of the boundary.",
      reassurance: "This is an early heads-up, not a confirmed crossing."
    };
  }

  if (state === "unknown") {
    return {
      eyebrow: "Setup incomplete",
      headline: "Home Zone is not active",
      detail: `Navora has ${patientName}’s location, but no active boundary is available to evaluate it.`,
      reassurance: "Create Home Zone before relying on boundary alerts."
    };
  }

  return {
    eyebrow: STATE_CHIP_LABEL.safe,
    headline: `${patientName} is safe at home`,
    detail: "Everything looks okay. The latest update places them inside Home Zone.",
    reassurance: "You don’t need to do anything — Navora will tell the family if that changes."
  };
}

function useBattery() {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let manager: BatteryManagerLike | null = null;
    let cancelled = false;

    async function readBattery() {
      const nav = navigator as NavigatorWithBattery;
      if (!nav.getBattery) {
        setSupported(false);
        return;
      }

      manager = await nav.getBattery();

      const update = () => {
        if (!cancelled && manager) {
          setBattery({
            level: manager.level,
            charging: manager.charging
          });
        }
      };

      manager.addEventListener("levelchange", update);
      manager.addEventListener("chargingchange", update);
      update();
    }

    readBattery().catch(() => setSupported(false));

    return () => {
      cancelled = true;
    };
  }, []);

  return { battery, supported };
}

function useServiceWorkerRegistration() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    import("./lib/push")
      .then(({ ensureActiveServiceWorker }) => ensureActiveServiceWorker())
      .then(setRegistration)
      .catch((error) => console.warn("Service worker registration failed", error));
  }, []);

  return registration;
}

function ema(previous: LatLngPoint | null, next: LatLngPoint) {
  if (!previous) {
    return next;
  }

  const alpha = 0.45;
  return {
    lat: previous.lat * (1 - alpha) + next.lat * alpha,
    lng: previous.lng * (1 - alpha) + next.lng * alpha
  };
}

function toLeafletPoints(points: LatLngPoint[]): L.LatLngExpression[] {
  return points.map((point) => [point.lat, point.lng] as L.LatLngExpression);
}

const EARTH_RADIUS_M = 6371000;

function metersBetweenPoints(a: LatLngPoint, b: LatLngPoint) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function zoneCenter(points: LatLngPoint[]): LatLngPoint {
  const sum = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

function zoneRadiusM(points: LatLngPoint[], center = zoneCenter(points)) {
  const total = points.reduce((acc, point) => acc + metersBetweenPoints(center, point), 0);
  return total / points.length;
}

function circleZonePoints(center: LatLngPoint, radiusM: number): LatLngPoint[] {
  const latitudeRadians = (center.lat * Math.PI) / 180;
  return Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    const north = Math.cos(angle) * radiusM;
    const east = Math.sin(angle) * radiusM;
    return {
      lat: center.lat + (north / EARTH_RADIUS_M) * (180 / Math.PI),
      lng: center.lng + (east / (EARTH_RADIUS_M * Math.cos(latitudeRadians))) * (180 / Math.PI)
    };
  });
}

const MIN_ZONE_RADIUS_M = 30;
const MAX_ZONE_RADIUS_M = 1500;

// Position of the resize handle: due east of the zone center on the boundary.
function zoneRadiusHandlePosition(center: LatLngPoint, radiusM: number): LatLngPoint {
  const latitudeRadians = (center.lat * Math.PI) / 180;
  return {
    lat: center.lat,
    lng: center.lng + (radiusM / (EARTH_RADIUS_M * Math.cos(latitudeRadians))) * (180 / Math.PI)
  };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function fetchZones() {
  if (liveMode || householdId.startsWith("live-") || readLiveHousehold(householdId)) {
    const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
    return { zones: household.zones };
  }
  if (supabaseEnabled && householdId !== "demo-household") {
    return { zones: await fetchSupabaseZones(householdId) };
  }

  const response = await fetch(apiUrl(`/api/zones?householdId=${householdId}`));
  if (!response.ok) {
    throw new Error("Failed to fetch zones");
  }

  return (await response.json()) as { zones: Zone[] };
}

async function saveZone(zone: Partial<Zone> & { points: LatLngPoint[] }) {
  if (householdId === "demo-household" && !liveMode && !readLiveHousehold(householdId)) {
    // Sample mode has no backend; zones live only in this browser session.
    const demoZone: Zone = {
      id: zone.id || `demo-zone-${Date.now()}`,
      householdId,
      name: zone.name || "Home Zone",
      color: zone.color || "#8fd5ae",
      isActive: true,
      points: zone.points
    };
    return { zone: demoZone, zones: [demoZone] };
  }
  if (liveMode || readLiveHousehold(householdId)) {
    const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
    const nextZone: Zone = {
      id: zone.id || crypto.randomUUID(),
      householdId,
      name: zone.name || "Home Safe Zone",
      color: zone.color || "#8fbf9f",
      isActive: true,
      points: zone.points
    };
    return saveLiveZones(householdId, [
      ...household.zones.filter((item) => item.id !== nextZone.id),
      nextZone
    ]);
  }
  if (supabaseEnabled && householdId !== "demo-household") {
    return saveSupabaseZone(householdId, zone);
  }

  const response = await fetch(apiUrl("/api/zones"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      householdId,
      name: zone.name || "Home Safe Zone",
      color: zone.color || "#8fbf9f",
      isActive: true,
      ...zone
    })
  });

  if (!response.ok) {
    throw new Error((await response.json()).error || "Failed to save zone");
  }

  return (await response.json()) as { zone: Zone; zones: Zone[] };
}

async function deleteZone(zoneId: string) {
  if (liveMode || readLiveHousehold(householdId)) {
    const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
    return saveLiveZones(
      householdId,
      household.zones.filter((zone) => zone.id !== zoneId)
    );
  }
  if (supabaseEnabled && householdId !== "demo-household") {
    return deleteSupabaseZone(householdId, zoneId);
  }

  const response = await fetch(
    apiUrl(`/api/zones/${encodeURIComponent(zoneId)}?householdId=${encodeURIComponent(householdId)}`),
    { method: "DELETE" }
  );
  if (!response.ok) {
    throw new Error((await response.json()).error || "Failed to remove zone");
  }
  return (await response.json()) as { zones: Zone[] };
}

function App() {
  const path = window.location.pathname;

  if (path.startsWith("/patient")) {
    return <PatientView />;
  }

  if (path.startsWith("/onboarding")) {
    return <OnboardingFlow />;
  }

  if (path.startsWith("/live")) {
    const household = ensureLiveHousehold(initialQuery.get("household"));
    if (initialQuery.get("household") !== household.id) {
      window.location.replace(`/live?household=${encodeURIComponent(household.id)}`);
      return null;
    }
    return <CaregiverView />;
  }

  if (path.startsWith("/caregiver")) {
    const isDemo = initialQuery.get("demo") === "1";
    if (!isDemo && !supabaseEnabled) {
      const storedHousehold = window.localStorage.getItem("safezone-household-id");
      const completedHousehold = window.localStorage.getItem("safezone-setup-complete");
      if (!storedHousehold || completedHousehold !== storedHousehold) {
        window.location.replace("/onboarding");
        return null;
      }
    }
    return supabaseEnabled && !isDemo ? (
      <AuthGate>
        <CaregiverBootstrap>
          <CaregiverView />
        </CaregiverBootstrap>
      </AuthGate>
    ) : (
      <CaregiverView />
    );
  }

  return <WelcomeView />;
}

function PatientView() {
  const { battery } = useBattery();
  const pairingToken = initialQuery.get("pair");
  const patientLiveMode = liveMode || initialQuery.get("live") === "1";
  const deviceTokenKey = `safezone-patient-token:${householdId}`;
  const [patientName, setPatientName] = useState(
    () => window.localStorage.getItem("safezone-patient-name") || ""
  );
  const [activationState, setActivationState] = useState<"checking" | "paired" | "unpaired" | "error">(
    householdId === "demo-household" ? "paired" : "checking"
  );
  const [activationMessage, setActivationMessage] = useState("Confirming this patient device…");
  const [caregiverName, setCaregiverName] = useState("");
  const lastSentAt = useRef(0);
  const [trackingState, setTrackingState] = useState<"starting" | "active" | "blocked" | "error">("starting");
  const [lastPing, setLastPing] = useState<LocationPing | null>(null);
  const [serverState, setServerState] = useState<GeofenceState>("unknown");
  const [message, setMessage] = useState("Preparing location tracking...");
  const wakeLockEngaged = useScreenWakeLock(activationState === "paired");
  const offlineQueueKey = `safezone-offline-pings:${householdId}`;
  const [queuedCount, setQueuedCount] = useState(() => readOfflineQueue(offlineQueueKey).length);
  const [manualCode, setManualCode] = useState("");
  const [claimingCode, setClaimingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function claimWithManualCode(event: FormEvent) {
    event.preventDefault();
    const code = manualCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setCodeError("Enter all 6 digits shown on the caregiver screen.");
      return;
    }
    setClaimingCode(true);
    setCodeError(null);
    try {
      const result = supabaseEnabled
        ? await claimSupabasePairingByCode(code)
        : await fetch("/api/pairing/claim-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
          }).then(async (response) => {
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "This pairing code could not be used.");
            return payload as { deviceToken: string; household: { id: string; patientName: string } };
          });

      window.localStorage.setItem(`safezone-patient-token:${result.household.id}`, result.deviceToken);
      window.localStorage.setItem("safezone-household-id", result.household.id);
      window.localStorage.setItem("safezone-patient-name", result.household.patientName);
      window.location.replace(`/patient?household=${encodeURIComponent(result.household.id)}`);
    } catch (caught) {
      setCodeError(caught instanceof Error ? caught.message : "This pairing code could not be used.");
      setClaimingCode(false);
    }
  }

  useEffect(() => {
    if (householdId === "demo-household") return;

    const storedToken = window.localStorage.getItem(deviceTokenKey);
    if (storedToken) {
      setActivationState("paired");
      return;
    }

    if (!pairingToken) {
      setActivationState("unpaired");
      setActivationMessage("This phone needs a pairing code from the caregiver dashboard.");
      return;
    }

    const claim = patientLiveMode
      ? Promise.resolve().then(() => claimLivePairing(householdId, pairingToken))
      : supabaseEnabled
        ? claimSupabasePairing(householdId, pairingToken)
        : fetch("/api/pairing/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ householdId, token: pairingToken })
          }).then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "This pairing link could not be used.");
            return result;
          });

    claim
      .then((result) => {
        window.localStorage.setItem(deviceTokenKey, result.deviceToken);
        window.localStorage.setItem("safezone-household-id", householdId);
        window.localStorage.setItem("safezone-patient-name", result.household.patientName);
        setPatientName(result.household.patientName);
        setCaregiverName(result.household.caregiverName || "");
        setActivationState("paired");
        window.history.replaceState(
          {},
          "",
          `/patient?${patientLiveMode ? "live=1&" : ""}household=${encodeURIComponent(householdId)}`
        );
      })
      .catch((caught) => {
        setActivationState("error");
        setActivationMessage(caught instanceof Error ? caught.message : "This pairing link could not be used.");
      });
  }, [deviceTokenKey, pairingToken, patientLiveMode]);

  useEffect(() => {
    if (activationState !== "paired" || householdId === "demo-household") {
      if (householdId === "demo-household") setCaregiverName("Sarah");
      return;
    }

    if (patientLiveMode) {
      const household = readLiveHousehold(householdId);
      if (household) {
        setCaregiverName(household.caregiverName || "");
        if (household.patientName) setPatientName(household.patientName);
      }
      return;
    }

    (supabaseEnabled
      ? getSupabaseHouseholdProfile(householdId).then((household) => ({ household }))
      : fetch(`/api/households/${encodeURIComponent(householdId)}`).then(async (response) => {
          if (!response.ok) return null;
          return response.json();
        }))
      .then((result) => {
        if (!result?.household) return;
        setCaregiverName(result.household.caregiverName || "");
        if (result.household.patientName) setPatientName(result.household.patientName);
      })
      .catch(() => {
        // Tracking can continue even if the display profile is temporarily unavailable.
      });
  }, [activationState, patientLiveMode]);

  useEffect(() => {
    if (activationState !== "paired") return;

    if (!("geolocation" in navigator)) {
      setTrackingState("blocked");
      setMessage("This device does not support browser location tracking.");
      return;
    }

    // Supabase free plan: every ping is a database insert plus Realtime
    // messages, so real households send every 5s. Demo and /live modes stay
    // at 2.2s because they never touch Supabase.
    const usesSupabaseBackend = supabaseEnabled && householdId !== "demo-household" && !patientLiveMode;
    const sendIntervalMs = usesSupabaseBackend ? 5000 : 2200;

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - lastSentAt.current < sendIntervalMs) {
          return;
        }

        lastSentAt.current = now;
        setTrackingState("active");
        setMessage("Location was shared successfully.");

        const payload: QueuedPing = {
          householdId,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp || Date.now()).toISOString(),
          battery: battery ? Math.round(battery.level * 100) : null
        };

        const deviceToken = window.localStorage.getItem(deviceTokenKey);
        const transmit = async (ping: QueuedPing) =>
          patientLiveMode
            ? ingestLiveLocation(
                householdId,
                {
                  lat: ping.lat,
                  lng: ping.lng,
                  accuracy: ping.accuracy,
                  battery: ping.battery,
                  timestamp: ping.timestamp
                },
                getLiveGeofenceMemory(householdId)
              )
            : supabaseEnabled && householdId !== "demo-household"
            ? await ingestSupabaseLocation(ping, deviceToken || "")
            : await fetch(apiUrl("/api/location"), {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {})
                },
                body: JSON.stringify(ping)
              }).then(async (response) => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Navora could not accept this location.");
                return result as { state: GeofenceState; previousState: GeofenceState; graceEndsAt?: string | null };
              });

        try {
          if (!deviceToken && householdId !== "demo-household" && !patientLiveMode) {
            throw new Error("This phone needs to be paired again.");
          }

          // Deliver pings buffered while offline first, oldest to newest, so
          // the caregiver timeline stays in order.
          let queue = readOfflineQueue(offlineQueueKey);
          while (queue.length > 0) {
            await transmit(queue[0]);
            queue = queue.slice(1);
            writeOfflineQueue(offlineQueueKey, queue);
            setQueuedCount(queue.length);
          }

          const result = await transmit(payload);

          if (
            (result.previousState === "grace" || result.previousState === "alert") &&
            (result.state === "safe" || result.state === "caution")
          ) {
            vibrate([200]);
          }

          setServerState(result.state);
          setLastPing({
            id: "latest",
            ...payload,
            stateAtTime: result.state,
            zoneId: null,
            distanceToBoundaryM: null,
            graceEndsAt: result.graceEndsAt || null
          });
        } catch (caught) {
          if (isLikelyOfflineError(caught)) {
            const queue = [...readOfflineQueue(offlineQueueKey), payload].slice(-OFFLINE_QUEUE_LIMIT);
            writeOfflineQueue(offlineQueueKey, queue);
            setQueuedCount(queue.length);
            setTrackingState("error");
            setMessage(
              `No internet right now. ${queue.length} location update${queue.length === 1 ? " is" : "s are"} saved on this phone and will send automatically when the connection returns.`
            );
            return;
          }
          setTrackingState("error");
          setMessage(
            caught instanceof Error
              ? `${caught.message} Navora will keep trying while this page is open.`
              : "Navora cannot reach the care circle. Check this phone’s internet connection; it will keep trying."
          );
        }
      },
      (error) => {
        setTrackingState(error.code === error.PERMISSION_DENIED ? "blocked" : "error");
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location access is off. Allow location for Navora in this browser’s settings, then try again."
            : "This phone cannot get a location right now. Move near a window or outdoors, then try again."
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activationState, battery, deviceTokenKey]);

  if (activationState !== "paired") {
    return (
      <main className="patient-activation">
        <a href="/" className="brand-lockup"><span className="brand-mark"><span /><span /><span /></span><span>Navora</span></a>
        <section>
          <div className={`activation-symbol ${activationState}`} aria-hidden="true">
            {activationState === "checking" ? "…" : activationState === "error" ? "!" : "⌁"}
          </div>
          <p className="eyebrow">Navora phone setup</p>
          <h1>
            {activationState === "checking" ? "Connecting to your family…" : "Scan the caregiver’s pairing code"}
          </h1>
          <p>{activationMessage}</p>
          {activationState !== "checking" ? (
            <div className="activation-instructions">
              <span>1</span><p>Ask the caregiver to open <strong>Care circle → Location phone</strong>.</p>
              <span>2</span><p>Scan the one-time QR code with this phone’s camera.</p>
              <span>3</span><p>Return here and allow location when asked.</p>
            </div>
          ) : null}
          {activationState !== "checking" && !patientLiveMode ? (
            <form className="manual-pair-form" onSubmit={claimWithManualCode}>
              <span>Camera not working? Type the 6-digit code from the caregiver screen instead.</span>
              <div className="manual-pair-row">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  aria-label="6-digit pairing code"
                  value={manualCode}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                    setManualCode(digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits);
                  }}
                />
                <button type="submit" disabled={claimingCode}>
                  {claimingCode ? "Connecting…" : "Connect"}
                </button>
              </div>
              {codeError ? <p className="error" role="alert">{codeError}</p> : null}
            </form>
          ) : null}
        </section>
      </main>
    );
  }

  const patientPresentation =
    trackingState === "active"
      ? {
          symbol: "✓",
          eyebrow: "CONNECTED",
          headline: "Location sharing is on",
          detail: `${patientName || "This phone"} is connected to ${caregiverName ? `${caregiverName} and the family care circle` : "the family care circle"}.`
        }
      : trackingState === "blocked"
        ? {
            symbol: "!",
            eyebrow: "ACTION NEEDED",
            headline: "Location access is off",
            detail: "Navora cannot update the family until location access is allowed on this phone."
          }
        : trackingState === "error"
          ? {
              symbol: "↻",
              eyebrow: "RECONNECTING",
              headline: "Trying to reconnect",
              detail: "Keep this page open and check that this phone has internet access."
            }
          : {
              symbol: "…",
              eyebrow: "STARTING",
              headline: "Allow location to begin",
              detail: "When this phone asks, choose Allow so the care circle can see the latest location."
            };

  return (
    <main className="patient-screen">
      <section className={`patient-card ${classForState(serverState)}`}>
        <header className="patient-device-header">
          <span className="brand-lockup"><span className="brand-mark"><span /><span /><span /></span><span>Navora</span></span>
          <span>Navora phone</span>
        </header>
        <div className={`patient-primary-state ${trackingState}`} role="status" aria-live="polite">
          <span className="patient-state-symbol" aria-hidden="true">{patientPresentation.symbol}</span>
          <p>{patientPresentation.eyebrow}</p>
          <h1>{patientPresentation.headline}</h1>
          <strong>{patientPresentation.detail}</strong>
          <span>{message}</span>
        </div>
        {trackingState === "blocked" || trackingState === "error" ? (
          <button type="button" className="patient-retry" onClick={() => window.location.reload()}>
            Try location again
          </button>
        ) : null}
        <div className="patient-care-notes">
          <p>
            <span>1</span><strong>Keep this page open</strong>
            {wakeLockEngaged
              ? "Navora is keeping this screen awake so tracking never pauses. Just leave the page open."
              : "This browser page must remain open for continuous web location sharing."}
          </p>
          <p><span>2</span><strong>Add to Home Screen</strong>On iPhone, use Share → Add to Home Screen so Navora is easy to reopen.</p>
          <p><span>3</span><strong>Keep the phone charged</strong>Leave the phone with {patientName || "the person being cared for"}.</p>
          <p><span>4</span><strong>Family sees updates—not surveillance</strong>Navora shares reported location and accuracy with the connected care circle.</p>
        </div>
        <details className="patient-device-details">
          <summary>Device and location details</summary>
          <div className="patient-grid">
            <div><span>Last family update</span><strong>{freshnessLabel(lastPing)}</strong></div>
            <div><span>GPS accuracy</span><strong>{lastPing?.accuracy ? `About ${metersLabel(lastPing.accuracy)}` : "Waiting"}</strong></div>
            {battery ? <div><span>Phone battery</span><strong>{Math.round(battery.level * 100)}%</strong></div> : null}
            <div><span>Screen stays awake</span><strong>{wakeLockEngaged ? "Yes, while tracking" : "Managed by browser"}</strong></div>
            {queuedCount > 0 ? <div><span>Saved offline</span><strong>{queuedCount} update{queuedCount === 1 ? "" : "s"} waiting</strong></div> : null}
            <div>
              <span>Boundary status</span>
              <strong>
                {serverState === "safe"
                  ? "Inside Home Zone"
                  : serverState === "caution"
                    ? "Near boundary"
                    : serverState === "grace"
                      ? "Checking crossing"
                      : serverState === "alert"
                        ? "Outside Home Zone"
                        : "Waiting"}
              </strong>
            </div>
          </div>
          <p>Phone GPS is not room-level positioning. The caregiver map shows the accuracy radius reported by this phone.</p>
        </details>
      </section>
    </main>
  );
}

function CaregiverView() {
  const registration = useServiceWorkerRegistration();
  const { battery, supported: batterySupported } = useBattery();
  const demoMode = initialQuery.get("demo") === "1";
  const caregiverLiveMode = liveMode || Boolean(readLiveHousehold(householdId));
  const initialPatientName = demoMode
    ? "Mary Johnson"
    : window.localStorage.getItem("safezone-patient-name") || "";
  const requestedView = initialQuery.get("view");
  const activeView: DashboardView = ["map", "activity", "family", "settings"].includes(requestedView || "")
    ? (requestedView as DashboardView)
    : "overview";
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const normalLayerRef = useRef<L.TileLayer | null>(null);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const liveLayerRef = useRef<L.LayerGroup | null>(null);
  const historyLayerRef = useRef<L.LayerGroup | null>(null);
  const previousStateRef = useRef<GeofenceState>("unknown");
  const demoRunRef = useRef(0);
  const [caregiverLabel, setCaregiverLabel] = useState(
    () => demoMode ? "Sarah" : window.localStorage.getItem("safezone-caregiver-label") || ""
  );
  const [patientName, setPatientName] = useState(initialPatientName);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tileMode, setTileMode] = useState<"normal" | "satellite">("normal");
  const [confirmZoneDeleteId, setConfirmZoneDeleteId] = useState<string | null>(null);
  const [livePing, setLivePing] = useState<LocationPing | null>(null);
  const [smoothedLocation, setSmoothedLocation] = useState<LatLngPoint | null>(null);
  const [history, setHistory] = useState<LocationPing[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [presence, setPresence] = useState<PresenceViewer[]>([]);
  const [careResponse, setCareResponse] = useState<CareResponse | null>(null);
  const [careDeclines, setCareDeclines] = useState<CareResponse[]>([]);
  const [careHistory, setCareHistory] = useState<CareResponse[]>([]);
  const [patientPairedAt, setPatientPairedAt] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState("Push notifications are not set up on this device.");
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "offline">("connecting");
  const [visualPulse, setVisualPulse] = useState<GeofenceState>("unknown");
  const [confidenceExpanded, setConfidenceExpanded] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoResolved, setDemoResolved] = useState(false);
  const [livePairUrl, setLivePairUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());
  const [alertCooldownMin, setAlertCooldownMin] = useState(() => {
    const stored = window.localStorage.getItem("safezone-alert-cooldown-min");
    const parsed = stored === null ? NaN : Number(stored);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
  });
  const alertCooldownMinRef = useRef(alertCooldownMin);
  const lastAlertEffectAtRef = useRef(0);

  function updateAlertCooldown(minutes: number) {
    setAlertCooldownMin(minutes);
    alertCooldownMinRef.current = minutes;
    window.localStorage.setItem("safezone-alert-cooldown-min", String(minutes));
  }

  const currentState = livePing?.stateAtTime || "unknown";
  const isLocationStale = livePing ? nowTick - Date.parse(livePing.timestamp) > 60000 : false;
  const presentedState: GeofenceState =
    isLocationStale && currentState !== "alert" && currentState !== "grace" ? "unknown" : currentState;
  const safetyCopy = humanSafetyCopy(currentState, livePing, isLocationStale, patientName);
  const connectionLabel = !livePing
    ? "Waiting"
    : connectionState === "offline"
      ? "Offline"
      : isLocationStale
        ? "Stale · Last known"
        : connectionState === "live"
          ? "Live"
          : "Connecting";
  const careConfidence = calculateCareConfidence(livePing, connectionState, currentState, nowTick);
  const notificationReady = pushStatus.includes("active");
  const otherViewers = useMemo(
    () => presence.filter((viewer) => viewer.label !== caregiverLabel),
    [caregiverLabel, presence]
  );
  const replayPing = replayIndex === null ? null : history[replayIndex] || null;

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), currentState === "grace" ? 1000 : 10000);
    return () => window.clearInterval(interval);
  }, [currentState]);

  useEffect(() => {
    if (careConfidence.level === "attention" || careConfidence.level === "critical") {
      setConfidenceExpanded(true);
    }
  }, [careConfidence.level]);

  useEffect(() => {
    if (caregiverLabel.trim()) {
      window.localStorage.setItem("safezone-caregiver-label", caregiverLabel.trim());
    }
  }, [caregiverLabel]);

  useEffect(() => {
    fetchZones()
      .then(({ zones }) => setZones(zones))
      .catch((error) => setError(error.message));

    if (caregiverLiveMode) {
      const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
      setPatientName(household.patientName);
      setCaregiverLabel(household.caregiverName || caregiverLabel || "Sarah");
      setPatientPairedAt(household.pairedAt);
      setHistory(household.history);
      if (household.latest) {
        setLivePing(household.latest);
        setSmoothedLocation({ lat: household.latest.lat, lng: household.latest.lng });
        previousStateRef.current = household.latest.stateAtTime;
      }
      if (household.response) setCareResponse(household.response);
      setConnectionState("live");
      const pairing = createLivePairing(household.id);
      setLivePairUrl(pairing.patientURL);
      return;
    }

    if (supabaseEnabled && householdId !== "demo-household") {
      fetchSupabaseCareCoordination(householdId)
        .then((coordination) => {
          setCareResponse(coordination.active);
          setCareDeclines(coordination.declines);
          setCareHistory(coordination.history);
        })
        .catch(() => null);
    }

    (supabaseEnabled && householdId !== "demo-household"
      ? fetchSupabaseHistory(householdId)
      : fetch(apiUrl(`/api/history?householdId=${householdId}`)).then((response) => response.json()))
      .then((data) => setHistory(data.history || []))
      .catch(() => setHistory([]));

    (supabaseEnabled && householdId !== "demo-household"
      ? getSupabaseHouseholdProfile(householdId).then((household) => (household ? { household } : null))
      : fetch(apiUrl(`/api/households/${householdId}`)).then((response) => (response.ok ? response.json() : null)))
      .then((data) => {
        if (!data?.household) return;
        if (!demoMode && data.household.patientName) {
          setPatientName(data.household.patientName);
          window.localStorage.setItem("safezone-patient-name", data.household.patientName);
        }
        if (!demoMode && data.household.caregiverName) {
          setCaregiverLabel(data.household.caregiverName);
        }
        if (data.household.pairedAt) setPatientPairedAt(data.household.pairedAt);
      })
      .catch(() => undefined);
  }, [caregiverLiveMode]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapElementRef.current, {
      zoomControl: false,
      preferCanvas: true
    }).setView([37.7749, -122.4194], 16);

    normalLayerRef.current = L.tileLayer(normalTiles, {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
    }).addTo(map);
    satelliteLayerRef.current = L.tileLayer(satelliteTiles, {
      attribution: "Tiles &copy; Esri"
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    zonesLayerRef.current = L.layerGroup().addTo(map);
    liveLayerRef.current = L.layerGroup().addTo(map);
    historyLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const normalLayer = normalLayerRef.current;
    const satelliteLayer = satelliteLayerRef.current;

    if (!map || !normalLayer || !satelliteLayer) {
      return;
    }

    if (tileMode === "satellite") {
      if (map.hasLayer(normalLayer)) {
        map.removeLayer(normalLayer);
      }
      satelliteLayer.addTo(map);
    } else {
      if (map.hasLayer(satelliteLayer)) {
        map.removeLayer(satelliteLayer);
      }
      normalLayer.addTo(map);
    }
  }, [tileMode]);

  useEffect(() => {
    if (caregiverLiveMode) {
      setConnectionState("live");
      return subscribeLiveHousehold(householdId, "caregiver", (message) => {
        if (message.type === "household") {
          setZones(message.household.zones);
          setPatientPairedAt(message.household.pairedAt);
          setHistory(message.household.history);
          if (message.household.latest) {
            setLivePing(message.household.latest);
            setSmoothedLocation({ lat: message.household.latest.lat, lng: message.household.latest.lng });
          }
          if (message.household.response) setCareResponse(message.household.response);
          setCareDeclines(message.household.declines || []);
          return;
        }
        if (message.type === "zones") setZones(message.zones);
        if (message.type === "care_response") setCareResponse(message.response);
        if (message.type === "care_declines") setCareDeclines(message.declines);
        if (message.type === "patient_paired") setPatientPairedAt(message.pairedAt);
        if (message.type === "location") {
          const evaluated = ingestLiveLocation(
            householdId,
            {
              lat: message.ping.lat,
              lng: message.ping.lng,
              accuracy: message.ping.accuracy,
              battery: message.ping.battery,
              timestamp: message.ping.timestamp
            },
            getLiveGeofenceMemory(householdId),
            { broadcast: false }
          );
          setLivePing(evaluated.ping);
          setHistory((current) => {
            if (current.some((ping) => ping.id === evaluated.ping.id)) return current;
            return [...current.slice(-499), evaluated.ping];
          });
          setSmoothedLocation((current) => ema(current, { lat: evaluated.ping.lat, lng: evaluated.ping.lng }));
          setPatientPairedAt((current) => current || evaluated.ping.timestamp);
          if (evaluated.ping.stateAtTime !== previousStateRef.current) {
            handleStateChange(previousStateRef.current, evaluated.ping.stateAtTime);
            previousStateRef.current = evaluated.ping.stateAtTime;
          }
        }
      });
    }

    if (supabaseEnabled && householdId !== "demo-household") {
      return subscribeToHousehold(householdId, {
        onStatus: setConnectionState,
        onZones: setZones,
        onCareResponse: setCareResponse,
        onCareDeclines: setCareDeclines,
        onCareHistory: setCareHistory,
        onPatientPaired: setPatientPairedAt,
        onLocation: (message) => {
          setLivePing(message);
          setHistory((current) => {
            if (current.some((ping) => ping.id === message.id)) return current;
            return [...current.slice(-499), message];
          });
          setSmoothedLocation((current) => ema(current, { lat: message.lat, lng: message.lng }));
          if (message.stateAtTime === "safe" || message.stateAtTime === "caution") {
            if (previousStateRef.current === "alert" || previousStateRef.current === "grace") {
              setCareResponse(null);
              setCareDeclines([]);
              setDemoResolved(true);
            }
          }
          if (message.stateAtTime !== previousStateRef.current) {
            handleStateChange(previousStateRef.current, message.stateAtTime);
            previousStateRef.current = message.stateAtTime;
          }
        }
      });
    }

    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryCount = 0;
    let stopped = false;

    function connect() {
      if (stopped) return;
      setConnectionState(retryCount === 0 ? "connecting" : "offline");
      socket = new WebSocket(wsUrl(caregiverLabel, "caregiver"));

      socket.addEventListener("open", () => {
        retryCount = 0;
        setConnectionState("live");
        setError((current) => current?.startsWith("Live connection interrupted") ? null : current);
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerMessage;

        if (message.type === "hello" || message.type === "zones") setZones(message.zones);
        if (message.type === "presence") setPresence(message.viewers);
        if (message.type === "care_response") setCareResponse(message.response);
        if (message.type === "care_declines") setCareDeclines(message.declines);
        if (message.type === "patient_paired") setPatientPairedAt(message.pairedAt);

        if (message.type === "profile" && !demoMode) {
          setPatientName(message.patientName);
          window.localStorage.setItem("safezone-patient-name", message.patientName);
        }

        if (message.type === "location") {
          setLivePing(message);
          setHistory((current) => [...current.slice(-499), message]);
          setSmoothedLocation((current) => ema(current, { lat: message.lat, lng: message.lng }));

          if (message.stateAtTime !== previousStateRef.current) {
            handleStateChange(previousStateRef.current, message.stateAtTime);
            previousStateRef.current = message.stateAtTime;
          }
        }

        if (message.type === "state_change") {
          handleStateChange(message.previousState, message.state);
        }
      });

      socket.addEventListener("error", () => socket?.close());
      socket.addEventListener("close", () => {
        if (stopped) return;
        setConnectionState("offline");
        const delay = Math.min(30000, 1000 * 2 ** retryCount);
        retryCount += 1;
        setError(`Live connection interrupted. Reconnecting in ${Math.ceil(delay / 1000)} seconds.`);
        retryTimer = window.setTimeout(connect, delay);
      });
    }

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [caregiverLabel, caregiverLiveMode]);

  useEffect(() => {
    renderZones();
  }, [zones]);

  useEffect(() => {
    renderLiveLocation();
  }, [livePing, smoothedLocation, replayPing, history]);

  function handleStateChange(previousState: GeofenceState, nextState: GeofenceState) {
    if (previousState === nextState) {
      return;
    }

    setVisualPulse(nextState);

    if (nextState === "caution") {
      vibrate([120]);
    }

    if (nextState === "alert") {
      const cooldownMs = alertCooldownMinRef.current * 60 * 1000;
      const now = Date.now();
      // Boundary flapping can re-trigger alerts back to back. The dashboard
      // state always updates, but the strong vibration is calmed during the
      // configured cooldown window so repeated alerts don't cause panic.
      if (cooldownMs === 0 || now - lastAlertEffectAtRef.current >= cooldownMs) {
        vibrate([200, 100, 200, 100, 200]);
        lastAlertEffectAtRef.current = now;
      }
    }

    window.setTimeout(() => setVisualPulse("unknown"), 1800);
  }

  function renderZones() {
    const layer = zonesLayerRef.current;
    if (!layer) {
      return;
    }

    layer.clearLayers();

    zones.forEach((zone) => {
      if (zone.points.length < 3) {
        return;
      }

      const center = zoneCenter(zone.points);
      let radius = Math.max(MIN_ZONE_RADIUS_M, zoneRadiusM(zone.points, center));
      let livePoints = circleZonePoints(center, radius);

      // Draw as a true circle so families see a clean boundary, not a many-sided polygon.
      const circle = L.circle([center.lat, center.lng], {
        radius,
        color: zone.color,
        fillColor: zone.color,
        fillOpacity: 0.18,
        weight: 3
      }).addTo(layer);

      const moveHandle = L.marker([center.lat, center.lng], {
        draggable: true,
        icon: L.divIcon({
          className: "zone-move-handle",
          html: "⌂",
          iconSize: [38, 38],
          iconAnchor: [19, 19]
        })
      }).addTo(layer);
      moveHandle.bindTooltip("Drag to move the whole zone", { direction: "top", offset: [0, -18] });

      const handleStart = zoneRadiusHandlePosition(center, radius);
      const resizeHandle = L.marker([handleStart.lat, handleStart.lng], {
        draggable: true,
        icon: L.divIcon({
          className: "zone-resize-handle",
          html: "⇔",
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(layer);
      resizeHandle.bindTooltip(`About ${Math.round(radius)} m — drag to resize`, {
        direction: "top",
        offset: [0, -14]
      });

      moveHandle.on("drag", () => {
        const position = moveHandle.getLatLng();
        livePoints = circleZonePoints({ lat: position.lat, lng: position.lng }, radius);
        circle.setLatLng(position);
        const nextHandle = zoneRadiusHandlePosition({ lat: position.lat, lng: position.lng }, radius);
        resizeHandle.setLatLng([nextHandle.lat, nextHandle.lng]);
      });

      moveHandle.on("dragend", () => {
        void commitZoneChange({ ...zone, points: livePoints });
      });

      resizeHandle.on("drag", () => {
        const position = resizeHandle.getLatLng();
        const currentCenter = moveHandle.getLatLng();
        radius = Math.min(
          MAX_ZONE_RADIUS_M,
          Math.max(
            MIN_ZONE_RADIUS_M,
            metersBetweenPoints(
              { lat: currentCenter.lat, lng: currentCenter.lng },
              { lat: position.lat, lng: position.lng }
            )
          )
        );
        livePoints = circleZonePoints({ lat: currentCenter.lat, lng: currentCenter.lng }, radius);
        circle.setRadius(radius);
        resizeHandle.setTooltipContent(`About ${Math.round(radius)} m — drag to resize`);
      });

      resizeHandle.on("dragend", () => {
        const currentCenter = moveHandle.getLatLng();
        livePoints = circleZonePoints({ lat: currentCenter.lat, lng: currentCenter.lng }, radius);
        const snapped = zoneRadiusHandlePosition({ lat: currentCenter.lat, lng: currentCenter.lng }, radius);
        resizeHandle.setLatLng([snapped.lat, snapped.lng]);
        void commitZoneChange({ ...zone, points: livePoints });
      });
    });
  }

  async function commitZoneChange(zone: Zone) {
    if (demoMode) {
      setZones((current) => current.map((item) => (item.id === zone.id ? zone : item)));
      return;
    }
    try {
      const result = await saveZone(zone);
      setZones(result.zones);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the zone.");
    }
  }

  async function resizeZone(zone: Zone, radiusM: number) {
    const center = zoneCenter(zone.points);
    const nextRadius = Math.min(MAX_ZONE_RADIUS_M, Math.max(MIN_ZONE_RADIUS_M, radiusM));
    await commitZoneChange({
      ...zone,
      points: circleZonePoints(center, nextRadius)
    });
  }

  async function removeZone(zoneId: string) {
    setConfirmZoneDeleteId(null);
    if (demoMode) {
      setZones((current) => current.filter((zone) => zone.id !== zoneId));
      return;
    }
    try {
      const result = await deleteZone(zoneId);
      setZones(result.zones);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not remove the zone.");
    }
  }

  async function addHomeZone() {
    const map = mapRef.current;
    const center = livePing
      ? { lat: livePing.lat, lng: livePing.lng }
      : map
        ? { lat: map.getCenter().lat, lng: map.getCenter().lng }
        : { lat: 37.7749, lng: -122.4194 };

    const zone = {
      name: zones.length === 0 ? "Home Zone" : `Safe Zone ${zones.length + 1}`,
      color: zones.length === 0 ? "#8fd5ae" : "#6aa7b0",
      points: circleZonePoints(center, 120)
    };

    if (demoMode) {
      setZones((current) => [
        ...current,
        { id: `demo-zone-${Date.now()}`, householdId, isActive: true, ...zone }
      ]);
      map?.fitBounds(L.latLngBounds(toLeafletPoints(zone.points)).pad(0.6));
      return;
    }

    try {
      const result = await saveZone(zone);
      setZones(result.zones);
      map?.fitBounds(L.latLngBounds(toLeafletPoints(zone.points)).pad(0.6));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add the zone.");
    }
  }

  function renderLiveLocation() {
    const map = mapRef.current;
    const liveLayer = liveLayerRef.current;
    const historyLayer = historyLayerRef.current;

    if (!map || !liveLayer || !historyLayer) {
      return;
    }

    liveLayer.clearLayers();
    historyLayer.clearLayers();

    if (history.length > 1) {
      L.polyline(
        toLeafletPoints(history),
        { color: "#dce8df", weight: 2, opacity: 0.35 }
      ).addTo(historyLayer);
    }

    if (livePing && smoothedLocation) {
      L.circle([smoothedLocation.lat, smoothedLocation.lng], {
        radius: livePing.accuracy || 0,
        color: "#9fcfb1",
        fillColor: "#9fcfb1",
        fillOpacity: 0.12,
        weight: 1
      }).addTo(liveLayer);

      L.circleMarker([smoothedLocation.lat, smoothedLocation.lng], {
        radius: 9,
        color: "#0d2426",
        fillColor: livePing.stateAtTime === "alert" ? "#f26d5b" : livePing.stateAtTime === "caution" ? "#f2b35d" : "#9fcfb1",
        fillOpacity: 1,
        weight: 3
      }).addTo(liveLayer);

      map.panTo([smoothedLocation.lat, smoothedLocation.lng], { animate: true, duration: 0.35 });
    }

    if (replayPing) {
      L.circleMarker([replayPing.lat, replayPing.lng], {
        radius: 7,
        color: "#ffffff",
        fillColor: "#f2b35d",
        fillOpacity: 1,
        weight: 2
      }).addTo(historyLayer);
    }
  }

  async function saveFamilyProfile() {
    const caregiverName = caregiverLabel.trim();
    const lovedOneName = patientName.trim();
    if (!caregiverName || !lovedOneName) {
      setProfileStatus("Both names are required.");
      return;
    }
    if (demoMode) {
      setProfileStatus("Sample mode does not save profile changes.");
      return;
    }

    setProfileStatus("Saving…");
    try {
      const household = supabaseEnabled
        ? await createOrUpdateSupabaseHousehold({
            householdId,
            caregiverName,
            patientName: lovedOneName,
            patientRelationship: "Family member"
          })
        : await fetch(apiUrl(`/api/households/${householdId}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caregiverName, patientName: lovedOneName })
          }).then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Navora could not save these names.");
            return result.household;
          });
      setCaregiverLabel(household.caregiverName);
      setPatientName(household.patientName);
      window.localStorage.setItem("safezone-caregiver-label", household.caregiverName);
      window.localStorage.setItem("safezone-patient-name", household.patientName);
      setProfileStatus("Names updated for this care circle.");
    } catch (caught) {
      setProfileStatus(caught instanceof Error ? caught.message : "Navora could not save these names.");
    }
  }

  async function subscribeToPush() {
    if (!("Notification" in window) || !("PushManager" in window)) {
      setPushStatus("This browser does not support Web Push.");
      return;
    }

    try {
      const { ensureActiveServiceWorker, base64ToUint8Array } = await import("./lib/push");
      const activeRegistration = registration || (await ensureActiveServiceWorker());

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      if (isIOS && !isStandalone) {
        setPushStatus("On iPhone, tap Share → Add to Home Screen, then reopen Navora from its icon.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus("Notifications are off. Allow them in this device’s browser settings, then try again.");
        return;
      }

      let publicKey = vapidPublicKey;
      if (!supabaseEnabled) {
        const keyResponse = await fetch(apiUrl("/api/vapid-public-key"));
        if (!keyResponse.ok) throw new Error("Notifications are not configured on this Navora deployment.");
        publicKey = ((await keyResponse.json()) as { publicKey: string }).publicKey;
      }
      if (!publicKey) throw new Error("Notifications are not configured on this Navora deployment.");

      const existing = await activeRegistration.pushManager.getSubscription();
      const subscriptionObject =
        existing ||
        (await activeRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        }));

      if (supabaseEnabled) {
        await subscribeSupabasePush(householdId, caregiverLabel, subscriptionObject);
      } else {
        const subscribeResponse = await fetch(apiUrl("/api/subscribe"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            householdId,
            caregiverLabel,
            subscriptionObject
          })
        });
        if (!subscribeResponse.ok) {
          const result = await subscribeResponse.json().catch(() => null);
          throw new Error(result?.error || "Navora could not finish notification setup.");
        }
      }

      setPushStatus("Push notifications are active on this caregiver device.");
    } catch (caught) {
      setPushStatus(caught instanceof Error ? caught.message : "Notifications could not be enabled.");
    }
  }

  async function submitCareAction(action: CareResponseAction) {
    try {
      const response = caregiverLiveMode
        ? respondLive(householdId, caregiverLabel, action)
        : supabaseEnabled
          ? await submitSupabaseCareResponse(householdId, caregiverLabel, action)
          : await fetch(apiUrl("/api/respond"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                householdId,
                caregiverLabel,
                action
              })
            }).then(async (result) => {
              if (!result.ok) throw new Error("Navora could not share your response.");
              return ((await result.json()) as { response: CareResponse }).response;
            });

      if (action === "cant") {
        setCareDeclines((current) => [response, ...current.filter((item) => item.id !== response.id)]);
        setCareHistory((current) => [response, ...current]);
      } else {
        setCareResponse(response);
        setCareHistory((current) => [response, ...current]);
      }

    } catch (error) {
      setError(error instanceof Error ? error.message : "Navora could not share your response.");
    }
  }

  async function runGuidedDemo() {
    const runId = demoRunRef.current + 1;
    demoRunRef.current = runId;
    setDemoRunning(true);
    setDemoStep(1);
    setDemoResolved(false);
    setCareResponse(null);
    setPresence([]);
    setError(null);

    const center = { lat: 37.7749, lng: -122.4194 };
    const demoZone: Zone = {
      id: "hackathon-demo-home",
      householdId,
      name: "Home Zone",
      color: "#8fd5ae",
      isActive: true,
      points: [
        { lat: center.lat - 0.0009, lng: center.lng - 0.0011 },
        { lat: center.lat - 0.0009, lng: center.lng + 0.0011 },
        { lat: center.lat + 0.0009, lng: center.lng + 0.0011 },
        { lat: center.lat + 0.0009, lng: center.lng - 0.0011 }
      ]
    };

    const path = [
      { ...center, step: 1, wait: 1200 },
      { lat: center.lat + 0.00072, lng: center.lng + 0.00035, step: 2, wait: 2800 },
      { lat: center.lat + 0.00118, lng: center.lng + 0.00048, step: 3, wait: 2800 },
      { lat: center.lat + 0.0014, lng: center.lng + 0.00062, step: 3, wait: 2800 },
      { lat: center.lat + 0.00155, lng: center.lng + 0.00078, step: 3, wait: 2800 },
      { lat: center.lat + 0.00162, lng: center.lng + 0.0009, step: 4, wait: 2800 },
      { lat: center.lat + 0.00158, lng: center.lng + 0.00075, step: 4, wait: 2800 },
      { lat: center.lat + 0.0007, lng: center.lng + 0.0003, step: 5, wait: 2000 },
      { ...center, step: 5, wait: 0 }
    ];

    try {
      const zoneResult = await saveZone(demoZone);
      if (demoRunRef.current !== runId) return;
      setZones(zoneResult.zones);
      setPatientPairedAt(new Date().toISOString());
      setConnectionState("live");

      const memory = createGeofenceMemory();
      for (const point of path) {
        if (demoRunRef.current !== runId) return;
        setDemoStep(point.step);

        const timestamp = new Date().toISOString();
        const { ping, evaluation } = applyLocationLocally({
          memory,
          zones: zoneResult.zones,
          householdId,
          lat: point.lat,
          lng: point.lng,
          accuracy: 7,
          battery: 84,
          timestamp
        });

        if (caregiverLiveMode) {
          const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
          household.zones = zoneResult.zones;
          household.latest = ping;
          household.history = [...household.history, ping].slice(-120);
          household.pairedAt = household.pairedAt || timestamp;
          writeLiveHousehold(household);
        }

        setLivePing(ping);
        setHistory((current) => [...current.slice(-499), ping]);
        setSmoothedLocation((current) => ema(current, { lat: ping.lat, lng: ping.lng }));
        if (evaluation.state !== previousStateRef.current) {
          handleStateChange(previousStateRef.current, evaluation.state);
          previousStateRef.current = evaluation.state;
        }

        if (point.step === 4 && evaluation.state === "alert") {
          setPresence([
            { id: "demo-sarah", label: "Sarah" },
            { id: "demo-mike", label: "Mike" },
            { id: "demo-emma", label: "Emma" }
          ]);
          setCareResponse({
            id: "demo-response",
            caregiverLabel: "Sarah",
            status: "responding",
            timestamp: new Date().toISOString()
          });
        }

        if (point.step === 5 && evaluation.state === "safe") {
          setDemoResolved(true);
        }

        if (point.wait) await new Promise((resolve) => window.setTimeout(resolve, point.wait));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "The guided demo could not start.");
    } finally {
      if (demoRunRef.current === runId) {
        setDemoRunning(false);
      }
    }
  }

  const safeUpdates = history.filter((ping) => ping.stateAtTime === "safe").length;
  const boundaryEvents = history.filter(
    (ping, index) =>
      index > 0 &&
      ping.stateAtTime !== history[index - 1].stateAtTime &&
      ["caution", "grace", "alert"].includes(ping.stateAtTime)
  ).length;
  const safePercentage = history.length ? Math.round((safeUpdates / history.length) * 100) : 0;

  return (
    <DashboardShell
      activeView={activeView}
      caregiverName={caregiverLabel}
      patientName={patientName}
      connected={connectionState === "live"}
      demoMode={demoMode}
      householdId={householdId}
    >
      {caregiverLiveMode ? (
        <section className="demo-director" aria-label="Live tracker controls">
          <div className="demo-director-copy">
            <span className="demo-label"><i /> Live tracker</span>
            <strong>Pair a phone or simulate a path to test Navora</strong>
          </div>
          <button type="button" onClick={runGuidedDemo} disabled={demoRunning}>
            {demoRunning ? "Simulating…" : "Simulate exit path"}
          </button>
          {livePairUrl ? (
            <a href={livePairUrl} target="_blank" rel="noreferrer">
              Open patient tracker link
            </a>
          ) : null}
          <a href="/">Back home</a>
        </section>
      ) : null}
      {activeView !== "overview" && activeView !== "map" ? (
        <section
          className={`persistent-safety-bar state-${presentedState}`}
          aria-label="Current safety status"
          aria-live={presentedState === "alert" ? "assertive" : "polite"}
        >
          <span className="persistent-state-symbol" aria-hidden="true">
            {presentedState === "safe" ? "✓" : presentedState === "alert" ? "!" : presentedState === "caution" ? "…" : presentedState === "grace" ? "?" : "–"}
          </span>
          <div>
            <small>{safetyCopy.eyebrow} · {freshnessLabel(livePing)}</small>
            <strong>{safetyCopy.headline}</strong>
            {isLocationStale && (currentState === "alert" || currentState === "grace") ? <p>Last known state remains urgent, but the location is no longer current.</p> : null}
          </div>
          <a href={caregiverHref(undefined, false, householdId)}>
            {presentedState === "alert" || presentedState === "grace" ? "View location" : presentedState === "unknown" ? "Resolve setup" : "Open overview"}
          </a>
          {presentedState === "alert" ? (
            <AlertDecisionActions
              alertActive
              currentCaregiver={caregiverLabel}
              response={careResponse}
              declines={careDeclines}
              onAction={submitCareAction}
            />
          ) : null}
        </section>
      ) : null}
      {activeView === "activity" ? (
        <div className="dashboard-page activity-page">
          <section className="dashboard-metrics">
            <article><span className="metric-symbol safe">✓</span><div><small>Updates inside Home Zone</small><strong>{history.length ? `${safePercentage}%` : "—"}</strong><p>Share of recorded location updates—not time spent</p></div></article>
            <article><span className="metric-symbol">↗</span><div><small>Meaningful transitions</small><strong>{boundaryEvents}</strong><p>Approaches or crossings</p></div></article>
            <article><span className="metric-symbol">◷</span><div><small>Location updates</small><strong>{history.length}</strong><p>In this retained session</p></div></article>
          </section>
          <div className="activity-layout">
            <HumanTimeline history={history} responseHistory={careHistory} />
            <section className="dashboard-card insight-card">
              <div className="dashboard-card-heading"><div><span>Pattern summary</span><h2>What Navora observed</h2></div></div>
              <div className="insight-hero"><span>{safePercentage || "—"}{history.length ? "%" : ""}</span><p>of received updates were safely inside Home Zone.</p></div>
              <div className="insight-row"><span>Boundary activity</span><strong>{boundaryEvents === 0 ? "No crossings recorded" : `${boundaryEvents} meaningful event${boundaryEvents === 1 ? "" : "s"}`}</strong></div>
              <div className="insight-row"><span>Latest signal</span><strong>{freshnessLabel(livePing)}</strong></div>
              <p className="insight-note">Navora summarizes observed location states only. It does not predict wandering behavior.</p>
            </section>
          </div>
        </div>
      ) : activeView === "family" ? (
        <div className="dashboard-page family-page">
          <div className="family-layout">
            <PatientPairingCard householdId={householdId} patientName={patientName} initiallyPaired={Boolean(patientPairedAt)} />
            <FamilyCoordinationCard
              viewers={presence}
              currentCaregiver={caregiverLabel}
              alertActive={currentState === "alert"}
              response={careResponse}
              declines={careDeclines}
              householdId={householdId}
              demoMode={false}
              onCareAction={submitCareAction}
            />
          </div>
          <section className="dashboard-card family-explainer">
            <span className="family-explainer-icon">◎</span>
            <div><small>ONE SHARED TRUTH</small><h2>Everyone sees the same safety state.</h2><p>When something happens, Navora shows who is viewing and who has taken responsibility—without a frantic group-text thread.</p></div>
          </section>
        </div>
      ) : activeView === "settings" ? (
        <div className="dashboard-page settings-page">
          <section className="dashboard-card settings-section">
            <div className="dashboard-card-heading"><div><span>People</span><h2>Family profile</h2></div></div>
            <div className="settings-grid">
              <label>
                <span>Caregiver name</span>
                <input value={caregiverLabel} onChange={(event) => setCaregiverLabel(event.target.value)} required aria-invalid={!caregiverLabel.trim()} />
                {!caregiverLabel.trim() ? <small className="field-error">Add your name so family responses are clear.</small> : null}
              </label>
              <label>
                <span>Loved one’s name</span>
                <input value={patientName} onChange={(event) => setPatientName(event.target.value)} required aria-invalid={!patientName.trim()} />
                {!patientName.trim() ? <small className="field-error">Add a name for clear safety messages.</small> : null}
              </label>
            </div>
            <div className="profile-save-row">
              <button type="button" onClick={saveFamilyProfile} disabled={!caregiverLabel.trim() || !patientName.trim()}>Save names</button>
              {profileStatus ? <span role="status">{profileStatus}</span> : null}
            </div>
          </section>
          <section className="dashboard-card settings-section">
            <div className="dashboard-card-heading"><div><span>Notifications</span><h2>Alert readiness</h2></div><span className={`device-status ${notificationReady ? "paired" : ""}`}><i />{notificationReady ? "Ready" : "Needs setup"}</span></div>
            <p>See boundary warnings while the dashboard is open and receive a background notification after a confirmed crossing.</p>
            <button type="button" onClick={subscribeToPush}>{notificationReady ? "Refresh notification setup" : "Enable notifications"}</button>
            <p className="settings-footnote">On iPhone, install Navora to the Home Screen first for background Web Push.</p>
          </section>
          <section className="dashboard-card settings-section">
            <div className="dashboard-card-heading"><div><span>Calm alerts</span><h2>Repeat-alert cooldown</h2></div></div>
            <p>
              When {patientName || "your loved one"} walks near the boundary, the state can flip back and forth quickly.
              The map and safety state always update instantly—this only calms repeated alarm vibrations so the family
              isn’t startled over and over.
            </p>
            <label className="cooldown-control">
              <span>Quiet window between repeated alarms</span>
              <select value={alertCooldownMin} onChange={(event) => updateAlertCooldown(Number(event.target.value))}>
                <option value={0}>Off — every alert vibrates</option>
                <option value={2}>2 minutes</option>
                <option value={5}>5 minutes (recommended)</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
              </select>
            </label>
          </section>
          {isLocationStale || connectionState === "offline" || !livePing ? (
            <section className="dashboard-card settings-section reliability-recovery">
              <div className="dashboard-card-heading">
                <div>
                  <span>Recovery</span>
                  <h2>Patient phone guidance</h2>
                </div>
                <span className={`device-status ${isLocationStale ? "stale" : ""}`}>
                  <i />
                  {isLocationStale ? "Stale" : connectionState === "offline" ? "Offline" : "Waiting"}
                </span>
              </div>
              <p>
                Navora only receives location while the patient browser page stays open. While the page is open, Navora keeps the
                screen awake automatically, and any updates missed offline are saved on the phone and sent once it reconnects.
              </p>
              <ol className="recovery-steps">
                <li>Open Navora on {patientName || "the patient"}&apos;s phone from the Home Screen shortcut.</li>
                <li>Keep that page open and leave the phone charged and online.</li>
                <li>Confirm location permission is allowed for Navora in browser settings.</li>
                <li>If pairing was lost, return to Family and scan a new one-time QR code.</li>
              </ol>
              <p className="settings-footnote">The dashboard shows the last known location until a fresh ping arrives.</p>
            </section>
          ) : null}
          <section className="dashboard-card settings-section honesty-setting">
            <span>◉</span><div><h3>Honest location, always</h3><p>Navora displays the accuracy radius supplied by the patient phone and never claims indoor or room-level precision.</p></div>
          </section>
        </div>
      ) : (
      <section className={`caregiver-screen ${activeView === "map" ? "focus-map" : ""} ${classForState(currentState)} pulse-${visualPulse}`}>
      <aside className="sidebar">
        <SafetyHeroCard
          patientName={patientName}
          presentation={safetyCopy}
          state={presentedState}
          connection={connectionState}
          connectionLabel={connectionLabel}
          updatedLabel={freshnessLabel(livePing)}
          accuracyM={livePing?.accuracy ?? null}
          graceEndsAt={livePing?.graceEndsAt || null}
          response={careResponse}
          declines={careDeclines}
          resolved={demoResolved}
          demoMode={false}
          currentCaregiver={caregiverLabel}
          onCareAction={submitCareAction}
        />

        <TrustSignalsCard ping={livePing} connection={connectionState} connectionLabel={connectionLabel} />

        <CareConfidenceCard
          confidence={careConfidence}
          expanded={confidenceExpanded}
          onToggle={() => setConfidenceExpanded((expanded) => !expanded)}
        />

        <section className="readiness-card">
          <div>
            <span>Alerts</span>
            <strong>{notificationReady ? "Notifications are on" : "Notifications need setup"}</strong>
          </div>
          <button type="button" className={notificationReady ? "secondary" : ""} onClick={subscribeToPush}>
            {notificationReady ? "Manage" : "Enable alerts"}
          </button>
        </section>

        {zones.length === 0 ? (
          <section className="mode-card zone-empty-card">
            <span className="mode-label">Home Zone</span>
            <strong>Add Home Zone to the map</strong>
            <p>One tap places a circle. Drag the house to move it, drag the round handle to resize.</p>
            <button type="button" onClick={addHomeZone}>Add Home Zone</button>
          </section>
        ) : (
          <section className="mode-card zone-manager">
            <span className="mode-label">Home Zone</span>
            <ul className="zone-list">
              {zones.map((zone) => {
                const radius = Math.round(zoneRadiusM(zone.points));
                return (
                  <li key={zone.id}>
                    <span className="zone-swatch" style={{ background: zone.color }} aria-hidden="true" />
                    <div>
                      <strong>{zone.name}</strong>
                      <label className="zone-radius-slider">
                        <span>Size · {radius} m</span>
                        <input
                          type="range"
                          min={50}
                          max={400}
                          step={10}
                          value={Math.min(400, Math.max(50, radius))}
                          onChange={(event) => void resizeZone(zone, Number(event.target.value))}
                          aria-label={`Resize ${zone.name}`}
                        />
                      </label>
                    </div>
                    {confirmZoneDeleteId === zone.id ? (
                      <span className="zone-delete-confirm">
                        <button type="button" className="danger" onClick={() => removeZone(zone.id)}>Delete</button>
                        <button type="button" className="ghost" onClick={() => setConfirmZoneDeleteId(null)}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" className="ghost" onClick={() => setConfirmZoneDeleteId(zone.id)}>
                        Delete
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p>On the map: drag ⌂ to move the whole circle, or drag ⇔ to resize. Or use the size slider above.</p>
            <button type="button" className="secondary" onClick={addHomeZone}>Add another zone</button>
          </section>
        )}

        {otherViewers.length > 0 ? (
          <p className="presence-badge">{otherViewers.map((viewer) => viewer.label).join(", ")} is also watching.</p>
        ) : null}

        <HumanTimeline history={history} responseHistory={careHistory} />
        <FamilyCoordinationCard
          viewers={presence}
          currentCaregiver={caregiverLabel}
          alertActive={currentState === "alert"}
          response={careResponse}
          declines={careDeclines}
          householdId={householdId}
          demoMode={false}
          onCareAction={submitCareAction}
        />

        <section className="daily-actions">
          <button type="button" onClick={addHomeZone}>
            {zones.length === 0 ? "Add Home Zone" : "Add another zone"}
          </button>
          <button type="button" className="secondary" onClick={() => setTileMode(tileMode === "normal" ? "satellite" : "normal")}>
            {tileMode === "normal" ? "Satellite map" : "Normal map"}
          </button>
        </section>

        <details className="details-card">
          <summary>System details</summary>
          <div className="telemetry-grid">
            <div>
              <span>Boundary distance</span>
              <strong>{metersLabel(livePing?.distanceToBoundaryM ?? null)}</strong>
            </div>
            {batterySupported && battery ? (
              <div>
                <span>This device</span>
                <strong>{Math.round(battery.level * 100)}% battery</strong>
              </div>
            ) : null}
            <div>
              <span>Caregivers</span>
              <strong>{presence.length} viewing</strong>
            </div>
          </div>
          <p>{pushStatus}</p>
          <p className="ios-note">
            iOS Safari can receive background web push only after Navora is added to the Home Screen as a PWA.
          </p>
          {livePing?.graceEndsAt ? <p>Grace period ends at {new Date(livePing.graceEndsAt).toLocaleTimeString()}.</p> : null}
        </details>

        {error ? <p className="error" role="alert">{error}</p> : null}
      </aside>

      <section className="map-shell">
        <div className="map-toolbar">
          <span>{zones.length === 0 ? "No Home Zone yet" : tileMode === "satellite" ? "Satellite" : "Street map"}</span>
          <div className="map-toolbar-actions">
            <button type="button" onClick={addHomeZone}>
              {zones.length === 0 ? "Add Home Zone" : "Add zone"}
            </button>
            <button type="button" className="secondary" onClick={() => setTileMode(tileMode === "normal" ? "satellite" : "normal")}>
              {tileMode === "normal" ? "Satellite" : "Street"}
            </button>
          </div>
        </div>
        {zones.length === 0 ? (
          <div className="map-empty-hint">
            <strong>Add Home Zone</strong>
            <span>One tap places a circle you can drag and resize — no drawing needed.</span>
          </div>
        ) : null}
        <div ref={mapElementRef} className="map" />
        <div className="timeline">
          <div>
            <strong>Movement history</strong>
            <span>{history.length === 0 ? "Waiting for location history" : `${history.length} recent updates`}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, history.length - 1)}
            value={replayIndex ?? Math.max(0, history.length - 1)}
            disabled={history.length === 0}
            onChange={(event) => setReplayIndex(Number(event.target.value))}
          />
          <button type="button" className="ghost" onClick={() => setReplayIndex(null)}>
            Live
          </button>
        </div>
      </section>
      </section>
      )}
    </DashboardShell>
  );
}

export default App;
