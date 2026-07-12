import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  completeAuthFromUrl,
  getSession,
  sendMagicLink,
  supabase,
  supabaseEnabled,
  verifyEmailOtp
} from "./supabase";

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
        await completeAuthFromUrl();
      } catch (caught) {
        if (active) {
          setAuthError(caught instanceof Error ? caught.message : "Sign-in link could not be completed.");
        }
      }

      try {
        const value = await getSession();
        if (active) setSession(value);
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

export async function requestCaregiverLogin(email: string) {
  await sendMagicLink(email);
}

export async function verifyCaregiverLogin(email: string, token: string) {
  await verifyEmailOtp(email, token);
}
