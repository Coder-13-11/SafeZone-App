import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@safezone.local";
  if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey) {
    return json({ error: "Push environment is not configured." }, 500);
  }

  const body = await request.json().catch(() => ({}));
  const householdId = String(body.householdId || "");
  const title = String(body.title || "SafeZone alert");
  const message = String(body.body || "Open SafeZone for details.");
  const url = String(body.url || `/caregiver?household=${encodeURIComponent(householdId)}`);
  if (!householdId) return json({ error: "householdId is required." }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id, subscription")
    .eq("household_id", householdId);
  if (error) return json({ error: error.message }, 500);

  webPush.setVapidDetails(subject, publicKey, privateKey);
  const payload = JSON.stringify({ title, body: message, data: { url } });
  const results = await Promise.allSettled(
    (subscriptions || []).map((subscription) => webPush.sendNotification(subscription.subscription, payload))
  );

  const staleIds = results
    .map((result, index) => ({ result, subscription: subscriptions?.[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ subscription }) => subscription?.id)
    .filter(Boolean);
  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  return json({
    attempted: subscriptions?.length || 0,
    delivered: results.filter((result) => result.status === "fulfilled").length,
    removed: staleIds.length
  });
});
