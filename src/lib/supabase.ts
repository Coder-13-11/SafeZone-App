import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { CareResponse, GeofenceState, LatLngPoint, LocationPing, Zone } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const publicUrl =
  (import.meta.env.VITE_PUBLIC_URL as string | undefined) || window.location.origin;
export const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
export const supabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

type HouseholdRow = {
  id: string;
  patient_name: string;
  patient_relationship: string;
  paired_at: string | null;
  geofence_state: GeofenceState;
};

type MemberRow = {
  caregiver_label: string;
};

type ZoneRow = {
  id: string;
  household_id: string;
  name: string;
  color: string;
  points: LatLngPoint[];
  is_active: boolean;
};

type PingRow = {
  id: string;
  household_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  battery: number | null;
  state_at_time: GeofenceState;
  zone_id: string | null;
  distance_to_boundary_m: number | null;
  grace_ends_at: string | null;
  created_at: string;
};

type ResponseRow = {
  id: string;
  caregiver_label: string;
  status: CareResponse["status"];
  created_at: string;
};

export type HouseholdProfile = {
  id: string;
  patientName: string;
  caregiverName: string;
  pairedAt: string | null;
  relationship?: string;
  geofenceState?: GeofenceState;
};

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  return supabase;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user || null;
}

export async function sendMagicLink(email: string) {
  const client = requireSupabase();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${publicUrl}/onboarding` }
  });
  if (error) throw error;
}

export async function signOut() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function ensureProfile(displayName: string) {
  const client = requireSupabase();
  const user = await getUser();
  if (!user) throw new Error("Sign in before creating your family.");
  const { error } = await client.from("profiles").upsert({
    id: user.id,
    display_name: displayName.trim()
  });
  if (error) throw error;
}

export async function loadPrimaryHousehold(): Promise<HouseholdProfile | null> {
  const client = requireSupabase();
  const user = await getUser();
  if (!user) return null;
  const { data: member, error: memberError } = await client
    .from("household_members")
    .select("household_id, caregiver_label")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) return null;

  const { data: household, error: householdError } = await client
    .from("households")
    .select("id, patient_name, patient_relationship, paired_at, geofence_state")
    .eq("id", member.household_id)
    .single();
  if (householdError) throw householdError;
  return mapHousehold(household as HouseholdRow, member as MemberRow);
}

export async function getHouseholdProfile(householdId: string): Promise<HouseholdProfile | null> {
  const client = requireSupabase();
  const { data: household, error: householdError } = await client
    .from("households")
    .select("id, patient_name, patient_relationship, paired_at, geofence_state")
    .eq("id", householdId)
    .maybeSingle();
  if (householdError) throw householdError;
  if (!household) return null;

  const { data: member } = await client
    .from("household_members")
    .select("caregiver_label")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return mapHousehold(household as HouseholdRow, (member || { caregiver_label: "" }) as MemberRow);
}

export async function createOrUpdateHousehold(input: {
  householdId?: string;
  caregiverName: string;
  patientName: string;
  patientRelationship: string;
}) {
  const client = requireSupabase();
  const user = await getUser();
  if (!user) throw new Error("Sign in before creating your family.");
  await ensureProfile(input.caregiverName);

  if (input.householdId) {
    const { data: household, error } = await client
      .from("households")
      .update({
        patient_name: input.patientName.trim(),
        patient_relationship: input.patientRelationship
      })
      .eq("id", input.householdId)
      .select("id, patient_name, patient_relationship, paired_at, geofence_state")
      .single();
    if (error) throw error;
    const { error: memberError } = await client
      .from("household_members")
      .update({ caregiver_label: input.caregiverName.trim() })
      .eq("household_id", input.householdId)
      .eq("user_id", user.id);
    if (memberError) throw memberError;
    return mapHousehold(household as HouseholdRow, { caregiver_label: input.caregiverName });
  }

  const { data: household, error } = await client
    .from("households")
    .insert({
      owner_id: user.id,
      patient_name: input.patientName.trim(),
      patient_relationship: input.patientRelationship
    })
    .select("id, patient_name, patient_relationship, paired_at, geofence_state")
    .single();
  if (error) throw error;

  const { error: memberError } = await client.from("household_members").insert({
    household_id: household.id,
    user_id: user.id,
    role: "owner",
    caregiver_label: input.caregiverName.trim()
  });
  if (memberError) throw memberError;
  return mapHousehold(household as HouseholdRow, { caregiver_label: input.caregiverName });
}

export async function fetchZones(householdId: string): Promise<Zone[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("safe_zones")
    .select("id, household_id, name, color, points, is_active")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapZone);
}

export async function saveZone(householdId: string, zone: Partial<Zone> & { points: LatLngPoint[] }) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("safe_zones")
    .insert({
      household_id: householdId,
      name: zone.name || "Home Zone",
      color: zone.color || "#8fd5ae",
      points: zone.points,
      is_active: zone.isActive ?? true
    })
    .select("id, household_id, name, color, points, is_active")
    .single();
  if (error) throw error;
  return { zone: mapZone(data as ZoneRow), zones: await fetchZones(householdId) };
}

export async function fetchHistory(householdId: string, limit = 500): Promise<LocationPing[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("location_pings")
    .select("id, household_id, lat, lng, accuracy, battery, state_at_time, zone_id, distance_to_boundary_m, grace_ends_at, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse().map(mapPing);
}

export async function getPairingStatus(householdId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("households")
    .select("paired_at")
    .eq("id", householdId)
    .single();
  if (error) throw error;
  return { paired: Boolean(data.paired_at), pairedAt: data.paired_at as string | null };
}

export async function createPairing(householdId: string) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke("create_pairing", {
    body: { householdId }
  });
  if (error) throw error;
  return data as { pairingId: string; expiresAt: string; patientURL: string };
}

export async function claimPairing(householdId: string, token: string) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke("claim_pairing", {
    body: { householdId, token }
  });
  if (error) throw error;
  return data as {
    deviceToken: string;
    deviceId: string;
    household: HouseholdProfile;
  };
}

export async function ingestLocation(
  payload: {
    householdId: string;
    lat: number;
    lng: number;
    accuracy: number | null;
    timestamp: string;
    battery: number | null;
  },
  deviceToken: string
) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke("ingest_location", {
    body: payload,
    headers: { Authorization: `Bearer ${deviceToken}` }
  });
  if (error) throw error;
  return data as { id: string; timestamp: string; state: GeofenceState; previousState: GeofenceState; graceEndsAt: string | null };
}

export async function subscribePush(householdId: string, caregiverLabel: string, subscriptionObject: PushSubscription) {
  const client = requireSupabase();
  const user = await getUser();
  const jsonSubscription = subscriptionObject.toJSON();
  if (!jsonSubscription.endpoint) throw new Error("Push subscription endpoint is missing.");
  const { error } = await client.from("push_subscriptions").upsert(
    {
      household_id: householdId,
      user_id: user?.id || null,
      caregiver_label: caregiverLabel,
      endpoint: jsonSubscription.endpoint,
      subscription: jsonSubscription
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
}

export async function acknowledgeResponse(householdId: string, caregiverLabel: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("care_responses")
    .insert({ household_id: householdId, caregiver_label: caregiverLabel, status: "responding" })
    .select("id, caregiver_label, status, created_at")
    .single();
  if (error) throw error;
  return mapResponse(data as ResponseRow);
}

export function mapHousehold(row: HouseholdRow, member: MemberRow): HouseholdProfile {
  return {
    id: row.id,
    patientName: row.patient_name,
    caregiverName: member.caregiver_label,
    pairedAt: row.paired_at,
    relationship: row.patient_relationship,
    geofenceState: row.geofence_state
  };
}

export function mapZone(row: ZoneRow): Zone {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    color: row.color,
    points: row.points,
    isActive: row.is_active
  };
}

export function mapPing(row: PingRow): LocationPing {
  return {
    id: row.id,
    householdId: row.household_id,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    timestamp: row.created_at,
    battery: row.battery,
    stateAtTime: row.state_at_time,
    zoneId: row.zone_id,
    distanceToBoundaryM: row.distance_to_boundary_m,
    graceEndsAt: row.grace_ends_at
  };
}

export function mapResponse(row: ResponseRow): CareResponse {
  return {
    id: row.id,
    caregiverLabel: row.caregiver_label,
    status: row.status,
    timestamp: row.created_at
  };
}
