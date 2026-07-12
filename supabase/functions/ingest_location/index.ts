import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Point = { lat: number; lng: number };
type Zone = { id: string; points: Point[] };
type GeofenceState = "unknown" | "safe" | "caution" | "grace" | "alert";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const GRACE_PERIOD_MS = Number(Deno.env.get("GRACE_PERIOD_MS") || 10000);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceM(a: Point, b: Point) {
  const earthRadius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects = yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToPolygonM(point: Point, polygon: Point[]) {
  return Math.min(...polygon.map((vertex) => distanceM(point, vertex)));
}

function evaluateGeofence(
  household: { geofence_state: GeofenceState; grace_started_at: string | null },
  zones: Zone[],
  point: Point,
  now: Date
) {
  if (zones.length === 0) {
    return {
      state: "unknown" as GeofenceState,
      previousState: household.geofence_state,
      zoneId: null,
      distanceToBoundaryM: null,
      graceStartedAt: null,
      graceEndsAt: null,
      shouldPush: false
    };
  }

  const activeZone = zones.find((zone) => pointInPolygon(point, zone.points));
  if (activeZone) {
    const distanceToBoundaryM = distanceToPolygonM(point, activeZone.points);
    const avgRadius =
      activeZone.points.reduce((sum, vertex) => sum + distanceM(point, vertex), 0) /
      Math.max(1, activeZone.points.length);
    const state: GeofenceState = distanceToBoundaryM <= avgRadius * 0.2 ? "caution" : "safe";
    return {
      state,
      previousState: household.geofence_state,
      zoneId: activeZone.id,
      distanceToBoundaryM,
      graceStartedAt: null,
      graceEndsAt: null,
      shouldPush: false
    };
  }

  const graceStartedAt =
    household.geofence_state === "grace" && household.grace_started_at
      ? new Date(household.grace_started_at)
      : now;
  const elapsed = now.getTime() - graceStartedAt.getTime();
  const state: GeofenceState = elapsed >= GRACE_PERIOD_MS ? "alert" : "grace";
  return {
    state,
    previousState: household.geofence_state,
    zoneId: null,
    distanceToBoundaryM: null,
    graceStartedAt: graceStartedAt.toISOString(),
    graceEndsAt: new Date(graceStartedAt.getTime() + GRACE_PERIOD_MS).toISOString(),
    shouldPush: state === "alert" && household.geofence_state !== "alert"
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase function environment is not configured." }, 500);
  }

  const auth = request.headers.get("Authorization") || "";
  const deviceToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!deviceToken) return json({ error: "Patient phone is not paired." }, 401);

  const body = await request.json().catch(() => ({}));
  const householdId = String(body.householdId || "");
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null;
  const battery = Number.isFinite(Number(body.battery)) ? Number(body.battery) : null;
  if (!householdId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "householdId, lat, and lng are required." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: device } = await supabase
    .from("patient_devices")
    .select("id, token_hash")
    .eq("household_id", householdId)
    .is("replaced_at", null)
    .maybeSingle();
  const deviceTokenHash = await sha256(deviceToken);
  if (!device || device.token_hash !== deviceTokenHash) {
    return json({ error: "This patient phone is not paired with the household." }, 401);
  }

  const { data: household, error: householdError } = await supabase
    .from("households")
    .select("id, patient_name, geofence_state, grace_started_at, alert_sent_for_exit")
    .eq("id", householdId)
    .single();
  if (householdError || !household) return json({ error: "Household not found." }, 404);

  const { data: zones } = await supabase
    .from("safe_zones")
    .select("id, points")
    .eq("household_id", householdId)
    .eq("is_active", true);

  const now = new Date();
  const evaluation = evaluateGeofence(
    household,
    (zones || []) as Zone[],
    { lat, lng },
    now
  );

  const { data: ping, error: pingError } = await supabase
    .from("location_pings")
    .insert({
      household_id: householdId,
      patient_device_id: device.id,
      lat,
      lng,
      accuracy,
      battery,
      state_at_time: evaluation.state,
      zone_id: evaluation.zoneId,
      distance_to_boundary_m: evaluation.distanceToBoundaryM,
      grace_ends_at: evaluation.graceEndsAt
    })
    .select("id, created_at")
    .single();
  if (pingError) return json({ error: pingError.message }, 500);

  await supabase.from("patient_devices").update({ last_seen_at: now.toISOString() }).eq("id", device.id);
  await supabase
    .from("households")
    .update({
      geofence_state: evaluation.state,
      grace_started_at: evaluation.graceStartedAt,
      alert_sent_for_exit: evaluation.state === "alert" ? true : false
    })
    .eq("id", householdId);

  if (evaluation.shouldPush) {
    const pushUrl = `${supabaseUrl}/functions/v1/send_push`;
    await fetch(pushUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        householdId,
        title: "SafeZone alert",
        body: `${household.patient_name} is reported outside Home Zone.`,
        url: `/caregiver?household=${encodeURIComponent(householdId)}`
      })
    }).catch(() => null);
  }

  return json({
    id: ping.id,
    timestamp: ping.created_at,
    state: evaluation.state,
    previousState: evaluation.previousState,
    graceEndsAt: evaluation.graceEndsAt
  });
});
