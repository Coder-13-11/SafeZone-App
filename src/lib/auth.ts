import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ensureCaregiverSession, getSession, supabase, supabaseEnabled } from "./supabase";

export function useSafeZoneSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseEnabled);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    (async () => {
      try {
        const next = await ensureCaregiverSession();
        if (active) {
          setSession(next);
          setAuthError(null);
        }
      } catch (caught) {
        if (active) {
          const existing = await getSession().catch(() => null);
          setSession(existing);
          setAuthError(
            caught instanceof Error ? caught.message : "SafeZone could not start a secure caregiver session."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      if (nextSession) setAuthError(null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    loading,
    authError,
    authenticated: !supabaseEnabled || Boolean(session)
  };
}
