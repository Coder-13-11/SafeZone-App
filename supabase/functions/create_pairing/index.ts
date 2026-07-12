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
  const publicUrl = Deno.env.get("PUBLIC_URL");
  if (!supabaseUrl || !serviceRoleKey || !publicUrl) {
    return json({ error: "Supabase function environment is not configured." }, 500);
  }

  const authorization = request.headers.get("Authorization") || "";
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authorization } }
  });
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Sign in before creating a pairing code." }, 401);

  const body = await request.json().catch(() => ({}));
  const householdId = String(body.householdId || "");
  if (!householdId) return json({ error: "householdId is required." }, 400);

  const { data: member } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json({ error: "You do not have access to this household." }, 403);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("pairing_sessions")
    .insert({
      household_id: householdId,
      token_hash: await sha256(token),
      expires_at: expiresAt,
      created_by: user.id
    })
    .select("id, expires_at")
    .single();
  if (error) return json({ error: error.message }, 500);

  const url = new URL("/patient", publicUrl);
  url.searchParams.set("household", householdId);
  url.searchParams.set("pair", token);
  return json({
    pairingId: data.id,
    expiresAt: data.expires_at,
    patientURL: url.toString()
  }, 201);
});
