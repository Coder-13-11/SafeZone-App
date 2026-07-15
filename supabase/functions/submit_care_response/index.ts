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

async function sendPush(
  supabaseUrl: string,
  serviceRoleKey: string,
  householdId: string,
  title: string,
  body: string
) {
  await fetch(`${supabaseUrl}/functions/v1/send_push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`
    },
    body: JSON.stringify({
      householdId,
      title,
      body,
      url: `/caregiver?household=${encodeURIComponent(householdId)}`
    })
  }).catch(() => null);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase environment is not configured." }, 500);
  }

  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Sign in required." }, 401);
  }

  const accessToken = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(accessToken);
  if (userError || !user) return json({ error: "Sign in required." }, 401);

  const body = await request.json().catch(() => ({}));
  const householdId = String(body.householdId || "");
  const caregiverLabel = String(body.caregiverLabel || "").trim();
  const action = String(body.action || "");
  if (!householdId || !caregiverLabel) {
    return json({ error: "householdId and caregiverLabel are required." }, 400);
  }
  if (!["going", "cant", "takeover"].includes(action)) {
    return json({ error: "action must be going, cant, or takeover." }, 400);
  }

  const { data: member } = await supabase
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json({ error: "You are not a member of this care circle." }, 403);

  const { data: household } = await supabase
    .from("households")
    .select("patient_name")
    .eq("id", householdId)
    .maybeSingle();

  const now = new Date().toISOString();
  let status: "responding" | "declined" | "takeover" = "responding";
  let pushTitle = "SafeZone";
  let pushBody = "";

  if (action === "cant") {
    status = "declined";
    const { data, error } = await supabase
      .from("care_responses")
      .insert({
        household_id: householdId,
        caregiver_label: caregiverLabel,
        status
      })
      .select("id, caregiver_label, status, resolved_at, created_at")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({
      response: {
        id: data.id,
        caregiverLabel: data.caregiver_label,
        status: data.status,
        timestamp: data.created_at,
        resolvedAt: data.resolved_at
      }
    });
  }

  if (action === "takeover") {
    status = "takeover";
    pushTitle = "SafeZone update";
    pushBody = `${caregiverLabel} took over`;
  } else {
    status = "responding";
    pushTitle = "SafeZone update";
    pushBody = `${caregiverLabel} is responding`;
  }

  await supabase
    .from("care_responses")
    .update({ resolved_at: now })
    .eq("household_id", householdId)
    .is("resolved_at", null)
    .in("status", ["responding", "takeover"]);

  const { data, error } = await supabase
    .from("care_responses")
    .insert({
      household_id: householdId,
      caregiver_label: caregiverLabel,
      status
    })
    .select("id, caregiver_label, status, resolved_at, created_at")
    .single();
  if (error) return json({ error: error.message }, 500);

  await sendPush(supabaseUrl, serviceRoleKey, householdId, pushTitle, pushBody);

  return json({
    response: {
      id: data.id,
      caregiverLabel: data.caregiver_label,
      status: data.status,
      timestamp: data.created_at,
      resolvedAt: data.resolved_at
    },
    patientName: household?.patient_name || null
  });
});
