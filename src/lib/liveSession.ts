import { Peer, type DataConnection } from "peerjs";
import type { CareResponse, LocationPing, Zone } from "../types";
import { applyLocationLocally, createGeofenceMemory, type GeofenceMemory } from "./geofence";

export type LiveHousehold = {
  id: string;
  patientName: string;
  caregiverName: string;
  pairedAt: string | null;
  pairToken: string | null;
  pairExpiresAt: string | null;
  zones: Zone[];
  history: LocationPing[];
  latest: LocationPing | null;
  response: CareResponse | null;
  declines: CareResponse[];
};

type LiveEnvelope =
  | { type: "hello"; household: LiveHousehold }
  | { type: "location"; ping: LocationPing }
  | { type: "zones"; zones: Zone[] }
  | { type: "patient_paired"; pairedAt: string }
  | { type: "care_response"; response: CareResponse | null }
  | { type: "care_declines"; declines: CareResponse[] }
  | { type: "profile"; patientName: string; caregiverName: string };

const STORAGE_PREFIX = "safezone-live:";
const channelName = (householdId: string) => `safezone-live-channel:${householdId}`;

function storageKey(householdId: string) {
  return `${STORAGE_PREFIX}${householdId}`;
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function defaultZone(householdId: string, center = { lat: 37.7749, lng: -122.4194 }): Zone {
  return {
    id: `live-home-${householdId.slice(0, 8)}`,
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
}

export function isLiveMode(search = window.location.search, path = window.location.pathname) {
  const query = new URLSearchParams(search);
  return query.get("live") === "1" || path.startsWith("/live");
}

export function readLiveHousehold(householdId: string): LiveHousehold | null {
  try {
    const raw = window.localStorage.getItem(storageKey(householdId));
    if (!raw) return null;
    const household = JSON.parse(raw) as LiveHousehold;
    household.declines = household.declines || [];
    return household;
  } catch {
    return null;
  }
}

export function writeLiveHousehold(household: LiveHousehold) {
  window.localStorage.setItem(storageKey(household.id), JSON.stringify(household));
  window.dispatchEvent(new CustomEvent("safezone-live-update", { detail: household.id }));
  try {
    const channel = new BroadcastChannel(channelName(household.id));
    channel.postMessage({ type: "household", household } satisfies { type: "household"; household: LiveHousehold });
    channel.close();
  } catch {
    // BroadcastChannel may be unavailable in some browsers.
  }
}

export function createLiveHousehold(input?: {
  caregiverName?: string;
  patientName?: string;
  center?: { lat: number; lng: number };
}) {
  const id = crypto.randomUUID();
  const household: LiveHousehold = {
    id,
    caregiverName: input?.caregiverName?.trim() || "Sarah",
    patientName: input?.patientName?.trim() || "Mary",
    pairedAt: null,
    pairToken: null,
    pairExpiresAt: null,
    zones: [defaultZone(id, input?.center)],
    history: [],
    latest: null,
    response: null,
    declines: []
  };
  writeLiveHousehold(household);
  window.localStorage.setItem("safezone-household-id", id);
  window.localStorage.setItem("safezone-setup-complete", id);
  window.localStorage.setItem("safezone-caregiver-label", household.caregiverName);
  window.localStorage.setItem("safezone-patient-name", household.patientName);
  return household;
}

export function ensureLiveHousehold(householdId?: string | null) {
  if (householdId) {
    const existing = readLiveHousehold(householdId);
    if (existing) return existing;
  }
  const stored = window.localStorage.getItem("safezone-household-id");
  if (stored) {
    const existing = readLiveHousehold(stored);
    if (existing) return existing;
  }
  return createLiveHousehold();
}

export function createLivePairing(householdId: string) {
  const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  household.pairToken = token;
  household.pairExpiresAt = expiresAt;
  writeLiveHousehold(household);

  const url = new URL("/patient", window.location.origin);
  url.searchParams.set("live", "1");
  url.searchParams.set("household", household.id);
  url.searchParams.set("pair", token);
  return { pairingId: token, expiresAt, patientURL: url.toString(), household };
}

export function claimLivePairing(householdId: string, token: string) {
  const household = readLiveHousehold(householdId);
  if (household) {
    if (!household.pairToken || household.pairToken !== token) {
      throw new Error("This pairing code is invalid. Create a new code on the caregiver dashboard.");
    }
    if (household.pairExpiresAt && Date.parse(household.pairExpiresAt) < Date.now()) {
      throw new Error("This pairing code expired. Create a new code on the caregiver dashboard.");
    }
  } else if (!token) {
    throw new Error("This pairing link is missing a code.");
  }

  const deviceToken = `live-${randomToken()}`;
  const pairedAt = new Date().toISOString();
  if (household) {
    household.pairedAt = pairedAt;
    household.pairToken = null;
    writeLiveHousehold(household);
  }

  window.localStorage.setItem(`safezone-patient-token:${householdId}`, deviceToken);
  window.localStorage.setItem("safezone-household-id", householdId);
  window.localStorage.setItem(
    "safezone-patient-name",
    household?.patientName || window.localStorage.getItem("safezone-patient-name") || "Mary"
  );

  return {
    deviceToken,
    household: {
      id: householdId,
      patientName: household?.patientName || "Mary",
      caregiverName: household?.caregiverName || "Sarah",
      pairedAt
    }
  };
}

export function ingestLiveLocation(
  householdId: string,
  payload: {
    lat: number;
    lng: number;
    accuracy: number | null;
    battery: number | null;
    timestamp: string;
  },
  memory: GeofenceMemory,
  options?: { broadcast?: boolean }
) {
  const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
  const { ping, evaluation } = applyLocationLocally({
    memory,
    zones: household.zones,
    householdId,
    ...payload
  });
  household.latest = ping;
  household.history = [...household.history, ping].slice(-120);
  if (!household.pairedAt) household.pairedAt = payload.timestamp;
  writeLiveHousehold(household);
  if (options?.broadcast !== false) {
    publishLive(householdId, { type: "location", ping });
  }
  return { ...evaluation, ping, household };
}

function publishLive(householdId: string, message: LiveEnvelope) {
  try {
    const channel = new BroadcastChannel(channelName(householdId));
    channel.postMessage(message);
    channel.close();
  } catch {
    // ignore
  }
  const peerState = peerConnections.get(householdId);
  if (peerState?.connection?.open) {
    peerState.connection.send(message);
  }
}

type PeerState = {
  peer: Peer;
  connection: DataConnection | null;
};

const peerConnections = new Map<string, PeerState>();
const geofenceMemories = new Map<string, GeofenceMemory>();

export function getLiveGeofenceMemory(householdId: string) {
  let memory = geofenceMemories.get(householdId);
  if (!memory) {
    memory = createGeofenceMemory();
    geofenceMemories.set(householdId, memory);
  }
  return memory;
}

export function subscribeLiveHousehold(
  householdId: string,
  role: "caregiver" | "patient",
  onMessage: (message: LiveEnvelope | { type: "household"; household: LiveHousehold }) => void
) {
  const channel = new BroadcastChannel(channelName(householdId));
  const onChannel = (event: MessageEvent) => onMessage(event.data);
  channel.addEventListener("message", onChannel);

  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey(householdId) && event.newValue) {
      try {
        onMessage({ type: "household", household: JSON.parse(event.newValue) as LiveHousehold });
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener("storage", onStorage);

  const peerId =
    role === "caregiver" ? `safezone-live-${householdId}` : `safezone-live-patient-${householdId}-${randomToken().slice(0, 6)}`;
  const peer = new Peer(peerId, { debug: 0 });
  const state: PeerState = { peer, connection: null };
  peerConnections.set(householdId, state);

  peer.on("open", () => {
    if (role === "patient") {
      const connection = peer.connect(`safezone-live-${householdId}`, { reliable: true });
      state.connection = connection;
      connection.on("open", () => {
        const household = readLiveHousehold(householdId);
        if (household) connection.send({ type: "hello", household });
      });
      connection.on("data", (data) => onMessage(data as LiveEnvelope));
    }
  });

  if (role === "caregiver") {
    peer.on("connection", (connection) => {
      state.connection = connection;
      connection.on("open", () => {
        const household = readLiveHousehold(householdId);
        if (household) connection.send({ type: "hello", household });
      });
      connection.on("data", (data) => {
        const message = data as LiveEnvelope;
        if (message.type === "location") {
          const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
          household.latest = message.ping;
          household.history = [...household.history, message.ping].slice(-120);
          if (!household.pairedAt) household.pairedAt = message.ping.timestamp;
          writeLiveHousehold(household);
        }
        onMessage(message);
      });
    });
  }

  return () => {
    channel.removeEventListener("message", onChannel);
    channel.close();
    window.removeEventListener("storage", onStorage);
    peer.destroy();
    peerConnections.delete(householdId);
  };
}

export function saveLiveZones(householdId: string, zones: Zone[]) {
  const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
  household.zones = zones;
  writeLiveHousehold(household);
  publishLive(householdId, { type: "zones", zones });
  return { zones };
}

export function respondLive(
  householdId: string,
  caregiverLabel: string,
  action: "going" | "cant" | "takeover" = "going"
) {
  const household = readLiveHousehold(householdId) || ensureLiveHousehold(householdId);
  household.declines = household.declines || [];

  if (action === "cant") {
    const decline: CareResponse = {
      id: crypto.randomUUID(),
      caregiverLabel,
      status: "declined",
      timestamp: new Date().toISOString(),
      resolvedAt: null
    };
    household.declines = [decline, ...household.declines].slice(0, 10);
    writeLiveHousehold(household);
    publishLive(householdId, { type: "care_declines", declines: household.declines });
    return decline;
  }

  const response: CareResponse = {
    id: crypto.randomUUID(),
    caregiverLabel,
    status: action === "takeover" ? "takeover" : "responding",
    timestamp: new Date().toISOString(),
    resolvedAt: null
  };
  household.response = response;
  writeLiveHousehold(household);
  publishLive(householdId, { type: "care_response", response });
  return response;
}
