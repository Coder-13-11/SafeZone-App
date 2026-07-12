import { useState } from "react";
import type React from "react";
import { requestCaregiverLogin, useSafeZoneSession } from "../lib/auth";
import { supabaseEnabled } from "../lib/supabase";
import { SafeZoneMark } from "./WelcomeView";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, loading } = useSafeZoneSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  if (!supabaseEnabled || authenticated) {
    return <>{children}</>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setStatus("");
    try {
      await requestCaregiverLogin(email.trim());
      setStatus("Check your email for a SafeZone sign-in link. Keep this tab open after you click it.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "SafeZone could not send the sign-in link.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <SafeZoneMark />
        <p className="eyebrow">Caregiver sign in</p>
        <h1>{loading ? "Checking your session…" : "Keep your family setup safe."}</h1>
        <p>
          Sign in once so SafeZone can restore your household, names, Home Zone, alerts, and pairing codes on every device.
        </p>
        {!loading ? (
          <form onSubmit={submit}>
            <label>
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            <button type="submit" disabled={sending}>
              {sending ? "Sending…" : "Email me a secure sign-in link"}
            </button>
          </form>
        ) : null}
        {status ? <p className="auth-status" role="status">{status}</p> : null}
      </section>
    </main>
  );
}
