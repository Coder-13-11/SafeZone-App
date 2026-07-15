export type GeofenceState = "unknown" | "safe" | "caution" | "grace" | "alert";

export type LatLngPoint = {
  lat: number;
  lng: number;
};

export type Zone = {
  id: string;
  householdId?: string;
  name: string;
  color: string;
  points: LatLngPoint[];
  isActive: boolean;
};

export type LocationPing = LatLngPoint & {
  id: string;
  householdId: string;
  accuracy: number | null;
  timestamp: string;
  battery: number | null;
  stateAtTime: GeofenceState;
  zoneId: string | null;
  distanceToBoundaryM: number | null;
  graceEndsAt: string | null;
};

export type PresenceViewer = {
  id: string;
  label: string;
};

export type CareResponseStatus = "responding" | "declined" | "takeover" | "help_requested";
export type CareResponseAction = "going" | "cant" | "takeover";

export type CareResponse = {
  id: string;
  caregiverLabel: string;
  status: CareResponseStatus;
  timestamp: string;
  resolvedAt?: string | null;
};

export type ServerMessage =
  | ({ type: "hello"; householdId: string; zones: Zone[] })
  | ({ type: "zones"; zones: Zone[] })
  | ({ type: "location" } & LocationPing)
  | {
      type: "state_change";
      state: GeofenceState;
      previousState: GeofenceState;
      graceEndsAt: string | null;
      timestamp: string;
    }
  | { type: "presence"; viewers: PresenceViewer[] }
  | { type: "care_response"; response: CareResponse | null }
  | { type: "care_declines"; declines: CareResponse[] }
  | { type: "patient_paired"; pairedAt: string }
  | { type: "profile"; patientName: string; caregiverName: string };

export type BatteryManagerLike = EventTarget & {
  level: number;
  charging: boolean;
  addEventListener(type: "levelchange" | "chargingchange", listener: () => void): void;
  removeEventListener(type: "levelchange" | "chargingchange", listener: () => void): void;
};

export type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>;
};
