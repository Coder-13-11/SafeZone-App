import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSafeZoneSession } from "../lib/auth";
import { loadPrimaryHousehold, supabaseEnabled } from "../lib/supabase";

export function CaregiverBootstrap({ children }: { children: ReactNode }) {
  const { authenticated, loading: authLoading } = useSafeZoneSession();
  const [ready, setReady] = useState(!supabaseEnabled);
  const [message, setMessage] = useState("Restoring your care circle…");
  const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";

  useEffect(() => {
    if (!supabaseEnabled || isDemo) {
      setReady(true);
      return;
    }

    if (authLoading) return;
    if (!authenticated) return;

    const storedHousehold = window.localStorage.getItem("safezone-household-id");
    const completedHousehold = window.localStorage.getItem("safezone-setup-complete");
    if (storedHousehold && completedHousehold === storedHousehold) {
      setReady(true);
      return;
    }

    loadPrimaryHousehold()
      .then((profile) => {
        if (!profile) {
          window.location.replace("/onboarding");
          return;
        }

        window.localStorage.setItem("safezone-household-id", profile.id);
        window.localStorage.setItem("safezone-caregiver-label", profile.caregiverName);
        window.localStorage.setItem("safezone-patient-name", profile.patientName);
        window.localStorage.setItem("safezone-setup-complete", profile.id);

        const url = new URL(window.location.href);
        if (url.searchParams.get("household") !== profile.id) {
          url.searchParams.set("household", profile.id);
          window.history.replaceState({}, "", url.toString());
        }

        setReady(true);
      })
      .catch((caught) => {
        setMessage(caught instanceof Error ? caught.message : "SafeZone could not restore your care circle.");
      });
  }, [authenticated, authLoading, isDemo]);

  if (!ready) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <p className="eyebrow">SafeZone</p>
          <h1>Loading your family setup</h1>
          <p role="status">{message}</p>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
