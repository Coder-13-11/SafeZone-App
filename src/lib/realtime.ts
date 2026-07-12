import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CareResponse, LocationPing, Zone } from "../types";
import { fetchHistory, fetchZones, mapPing, mapResponse, mapZone, supabase, supabaseEnabled } from "./supabase";

type SubscriptionHandlers = {
  onLocation?: (ping: LocationPing) => void;
  onZones?: (zones: Zone[]) => void;
  onCareResponse?: (response: CareResponse | null) => void;
  onPatientPaired?: (pairedAt: string | null) => void;
  onStatus?: (status: "connecting" | "live" | "offline") => void;
};

export function subscribeToHousehold(householdId: string, handlers: SubscriptionHandlers) {
  if (!supabaseEnabled || !supabase) {
    return () => undefined;
  }

  const client = supabase;
  handlers.onStatus?.("connecting");
  const channels: RealtimeChannel[] = [];

  const locations = client
    .channel(`safezone:locations:${householdId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "location_pings", filter: `household_id=eq.${householdId}` },
      (payload) => handlers.onLocation?.(mapPing(payload.new as never))
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") handlers.onStatus?.("live");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") handlers.onStatus?.("offline");
    });
  channels.push(locations);

  const zones = client
    .channel(`safezone:zones:${householdId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "safe_zones", filter: `household_id=eq.${householdId}` },
      async () => handlers.onZones?.(await fetchZones(householdId))
    )
    .subscribe();
  channels.push(zones);

  const responses = client
    .channel(`safezone:responses:${householdId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "care_responses", filter: `household_id=eq.${householdId}` },
      (payload) => handlers.onCareResponse?.(mapResponse(payload.new as never))
    )
    .subscribe();
  channels.push(responses);

  const household = client
    .channel(`safezone:household:${householdId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "households", filter: `id=eq.${householdId}` },
      (payload) => handlers.onPatientPaired?.((payload.new as { paired_at?: string | null }).paired_at || null)
    )
    .subscribe();
  channels.push(household);

  fetchHistory(householdId, 1)
    .then((history) => {
      const latest = history[history.length - 1];
      if (latest) handlers.onLocation?.(latest);
    })
    .catch(() => null);

  return () => {
    channels.forEach((channel) => client.removeChannel(channel));
  };
}
