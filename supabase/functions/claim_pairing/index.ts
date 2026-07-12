import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

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

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase function environment is not configured." }, 500);
  }

  const body = await request.json().catch(() => ({}));
  const householdId = String(body.householdId || "");
  const token = String(body.token || "");
  if (!householdId || !token) return json({ error: "householdId and token are required." }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tokenHash = await sha256(token);
  const { data: pairing, error: pairingError } = await supabase
    .from("pairing_sessions")
    .select("id, household_id, expires_at, claimed_at")
    .eq("household_id", householdId)
    .eq("token_hash", tokenHash)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (pairingError) return json({ error: pairingError.message }, 500);
  if (!pairing) return json({ error: "This pairing link is invalid or has expired." }, 410);

  const deviceToken = randomToken();
  await supabase
    .from("patient_devices")
    .update({ replaced_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .is("replaced_at", null);

  const { data: device, error: deviceError } = await supabase
    .from("patient_devices")
    .insert({
      household_id: householdId,
      token_hash: await sha256(deviceToken)
    })
    .select("id")
    .single();
  if (deviceError) return json({ error: deviceError.message }, 500);

  const claimedAt = new Date().toISOString();
  await supabase.from("pairing_sessions").update({ claimed_at: claimedAt }).eq("id", pairing.id);
  await supabase.from("households").update({ paired_at: claimedAt }).eq("id", householdId);

  const { data: household } = await supabase
    .from("households")
    .select("id, patient_name, paired_at")
    .eq("id", householdId)
    .single();
  const { data: ownerMember } = await supabase
    .from("household_members")
    .select("caregiver_label")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return json({
    deviceToken,
    deviceId: device.id,
    household: {
      id: household?.id || householdId,
      patientName: household?.patient_name || "Loved one",
      caregiverName: ownerMember?.caregiver_label || "",
      pairedAt: household?.paired_at || claimedAt
    }
  });
});
