import type { GeofenceState, LatLngPoint, LocationPing, Zone } from "../types";

const GRACE_PERIOD_MS = 10_000;

function metersBetween(a: LatLngPoint, b: LatLngPoint) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function project(point: LatLngPoint, origin: LatLngPoint) {
  const x = ((point.lng - origin.lng) * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (point.lat * Math.PI) / 360));
  const metersPerRadian = 6371000;
  return { x: x * Math.cos((origin.lat * Math.PI) / 180) * metersPerRadian, y: y * metersPerRadian };
}

function distanceToSegmentMeters(point: LatLngPoint, start: LatLngPoint, end: LatLngPoint) {
  const origin = point;
  const p = project(point, origin);
  const a = project(start, origin);
  const b = project(end, origin);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(point: LatLngPoint, polygon: LatLngPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function zoneMetrics(point: LatLngPoint, zone: Zone) {
  if (!zone.points || zone.points.length < 3) return null;
  const centroid = zone.points.reduce(
    (acc, zonePoint) => ({ lat: acc.lat + zonePoint.lat, lng: acc.lng + zonePoint.lng }),
    { lat: 0, lng: 0 }
  );
  centroid.lat /= zone.points.length;
  centroid.lng /= zone.points.length;

  let minBoundaryDistanceM = Infinity;
  let radiusM = 0;
  for (let i = 0; i < zone.points.length; i += 1) {
    const current = zone.points[i];
    const next = zone.points[(i + 1) % zone.points.length];
    minBoundaryDistanceM = Math.min(minBoundaryDistanceM, distanceToSegmentMeters(point, current, next));
    radiusM = Math.max(radiusM, metersBetween(centroid, current));
  }

  return {
    zone,
    isInside: pointInPolygon(point, zone.points),
    distanceToBoundaryM: Number.isFinite(minBoundaryDistanceM) ? minBoundaryDistanceM : null,
    cautionDistanceM: Math.max(10, radiusM * 0.2)
  };
}

export type GeofenceMemory = {
  state: GeofenceState;
  graceStartedAt: number | null;
  alertSentForExit: boolean;
};

export function createGeofenceMemory(): GeofenceMemory {
  return { state: "unknown", graceStartedAt: null, alertSentForExit: false };
}

export function evaluateGeofenceClient(
  memory: GeofenceMemory,
  zones: Zone[],
  point: LatLngPoint,
  timestamp: string
) {
  const activeZones = zones.filter((zone) => zone.isActive !== false);
  if (activeZones.length === 0) {
    memory.state = "unknown";
    memory.graceStartedAt = null;
    memory.alertSentForExit = false;
    return {
      state: "unknown" as GeofenceState,
      previousState: "unknown" as GeofenceState,
      stateChanged: false,
      zoneId: null as string | null,
      distanceToBoundaryM: null as number | null,
      graceEndsAt: null as string | null
    };
  }

  const metrics = activeZones.map((zone) => zoneMetrics(point, zone)).filter(Boolean) as NonNullable<
    ReturnType<typeof zoneMetrics>
  >[];
  const containingZone = metrics.find((metric) => metric.isInside);
  const previousState = memory.state;
  let state: GeofenceState = "safe";
  let graceEndsAt: string | null = null;
  const chosenMetric = containingZone || metrics[0];

  if (containingZone) {
    state =
      (containingZone.distanceToBoundaryM ?? Infinity) <= containingZone.cautionDistanceM
        ? "caution"
        : "safe";
    memory.graceStartedAt = null;
    memory.alertSentForExit = false;
  } else {
    if (!memory.graceStartedAt || previousState === "safe" || previousState === "caution") {
      memory.graceStartedAt = Date.parse(timestamp);
      memory.alertSentForExit = false;
    }
    const elapsed = Date.parse(timestamp) - (memory.graceStartedAt || Date.parse(timestamp));
    graceEndsAt = new Date((memory.graceStartedAt || Date.now()) + GRACE_PERIOD_MS).toISOString();
    state = elapsed >= GRACE_PERIOD_MS ? "alert" : "grace";
    if (state === "alert") memory.alertSentForExit = true;
  }

  memory.state = state;
  return {
    state,
    previousState,
    stateChanged: previousState !== state,
    zoneId: chosenMetric?.zone?.id || null,
    distanceToBoundaryM: chosenMetric?.distanceToBoundaryM ?? null,
    graceEndsAt
  };
}

export function applyLocationLocally(input: {
  memory: GeofenceMemory;
  zones: Zone[];
  householdId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  battery: number | null;
  timestamp: string;
}): { ping: LocationPing; evaluation: ReturnType<typeof evaluateGeofenceClient> } {
  const evaluation = evaluateGeofenceClient(
    input.memory,
    input.zones,
    { lat: input.lat, lng: input.lng },
    input.timestamp
  );
  return {
    evaluation,
    ping: {
      id: crypto.randomUUID(),
      householdId: input.householdId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy,
      timestamp: input.timestamp,
      battery: input.battery,
      stateAtTime: evaluation.state,
      zoneId: evaluation.zoneId,
      distanceToBoundaryM: evaluation.distanceToBoundaryM,
      graceEndsAt: evaluation.graceEndsAt
    }
  };
}
