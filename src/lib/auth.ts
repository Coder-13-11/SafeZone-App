import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, sendMagicLink, supabase, supabaseEnabled } from "./supabase";

export function useSafeZoneSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseEnabled);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    getSession()
      .then((value) => {
        if (active) setSession(value);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { session, loading, authenticated: !supabaseEnabled || Boolean(session) };
}

export async function requestCaregiverLogin(email: string) {
  await sendMagicLink(email);
}
