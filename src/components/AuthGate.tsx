import type React from "react";
import { useSafeZoneSession } from "../lib/auth";
import { supabaseEnabled } from "../lib/supabase";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, loading, authError } = useSafeZoneSession();

  if (!supabaseEnabled || authenticated) {
    return <>{children}</>;
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <p className="eyebrow">SafeZone</p>
        <h1>{loading ? "Starting your care session…" : "Could not start SafeZone"}</h1>
        <p role="status">
          {authError ||
            "SafeZone is preparing a secure caregiver session so your household setup can be saved."}
        </p>
      </section>
    </main>
  );
}
