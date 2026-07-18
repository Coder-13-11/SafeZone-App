import { useState } from "react";
import type React from "react";
import {
  continueWithoutEmail,
  requestCaregiverLogin,
  useNavoraSession,
  verifyCaregiverLogin
} from "../lib/auth";
import { supabaseEnabled } from "../lib/supabase";
import { NavoraMark } from "./WelcomeView";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, loading, authError } = useNavoraSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [skipping, setSkipping] = useState(false);

  if (!supabaseEnabled || authenticated) {
    return <>{children}</>;
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setStatus("");
    try {
      await requestCaregiverLogin(email.trim());
      setSent(true);
      setStatus("Check your email for a 6-digit code. You can also open the sign-in link in this same browser.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Navora could not send the sign-in email.");
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !code.trim()) return;
    setVerifying(true);
    setStatus("");
    try {
      await verifyCaregiverLogin(email.trim(), code.trim());
      setStatus("Signed in. Loading your family setup…");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "That code did not work. Try again or resend.");
    } finally {
      setVerifying(false);
    }
  }

  async function skipEmail() {
    setSkipping(true);
    setStatus("");
    try {
      await continueWithoutEmail();
      setStatus("Continuing without email…");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Could not continue without email.");
    } finally {
      setSkipping(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-busy={loading}>
        <a href="/" className="brand-lockup">
          <NavoraMark />
          <span>Navora</span>
        </a>
        <header className="auth-heading">
          <p className="eyebrow">Caregiver sign in</p>
          <h1>{loading ? "Checking your session…" : sent ? "Enter your code." : "Keep your family setup safe."}</h1>
          <p className="auth-lede">
            {sent
              ? `We emailed a 6-digit code to ${email.trim()}.`
              : "Sign in once so Navora can restore your names, Home Zone, alerts, and pairing on every device."}
          </p>
        </header>
        {!loading ? (
          <form onSubmit={sent ? verifyCode : sendCode}>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={sent && verifying}
              />
            </label>
            {sent ? (
              <label className="field">
                <span>6-digit code from email</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  className="code-input"
                  required
                />
              </label>
            ) : null}
            <button type="submit" disabled={sending || verifying || skipping}>
              {sent
                ? verifying
                  ? "Verifying…"
                  : "Verify code and continue"
                : sending
                  ? "Sending…"
                  : "Email me a secure sign-in code"}
            </button>
            <div className="auth-alt-actions">
              {sent ? (
                <button
                  type="button"
                  className="btn-text"
                  disabled={sending || skipping}
                  onClick={() => {
                    setSent(false);
                    setCode("");
                    setStatus("");
                  }}
                >
                  Use a different email
                </button>
              ) : null}
              <button type="button" className="btn-text" disabled={sending || verifying || skipping} onClick={skipEmail}>
                {skipping ? "Starting…" : "Continue without email"}
              </button>
            </div>
          </form>
        ) : null}
        {authError ? (
          <p className="auth-status is-error" role="alert">{authError}</p>
        ) : null}
        {status ? (
          <p className="auth-status" role="status">{status}</p>
        ) : null}
      </section>
    </main>
  );
}
