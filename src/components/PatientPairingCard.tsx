import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { createPairing as createSupabasePairing, supabase, supabaseEnabled } from "../lib/supabase";

export function PatientPairingCard({
  householdId,
  patientName,
  initiallyPaired = false
}: {
  householdId: string;
  patientName: string;
  initiallyPaired?: boolean;
}) {
  const [paired, setPaired] = useState(initiallyPaired);
  const [qrDataURL, setQrDataURL] = useState("");
  const [pairingURL, setPairingURL] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!qrDataURL || paired) return;
    if (supabaseEnabled && supabase) {
      const client = supabase;
      const channel = client
        .channel(`safezone:pairing-card:${householdId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "households", filter: `id=eq.${householdId}` },
          (payload) => {
            if ((payload.new as { paired_at?: string | null }).paired_at) setPaired(true);
          }
        )
        .subscribe();
      return () => {
        client.removeChannel(channel);
      };
    }

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/pairing/status?householdId=${householdId}`);
      if (!response.ok) return;
      const status = await response.json();
      if (status.paired) setPaired(true);
    }, 1800);
    return () => window.clearInterval(interval);
  }, [householdId, paired, qrDataURL]);

  async function createCode() {
    setLoading(true);
    setError(null);
    try {
      const result = supabaseEnabled
        ? await createSupabasePairing(householdId)
        : await fetch("/api/pairing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ householdId })
          }).then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not create a pairing code.");
            return result;
          });
      setPairingURL(result.patientURL);
      setExpiresAt(result.expiresAt);
      setShortCode((result as { shortCode?: string | null }).shortCode || "");
      setQrDataURL(
        await QRCode.toDataURL(result.patientURL, {
          width: 320,
          margin: 2,
          color: { dark: "#092326", light: "#f6f2e9" }
        })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a pairing code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dashboard-card patient-pair-card">
      <div className="dashboard-card-heading">
        <div><span>Location phone</span><h2>{paired ? `${patientName} is connected` : `Connect ${patientName}’s phone`}</h2></div>
        <span className={`device-status ${paired ? "paired" : ""}`}><i />{paired ? "Connected" : "Not paired"}</span>
      </div>

      {paired && !qrDataURL ? (
        <div className="paired-device-summary">
          <span className="paired-phone" aria-hidden="true">▯</span>
          <div><strong>{patientName}’s phone is paired</strong><p>The current phone remains connected unless a replacement code is claimed.</p></div>
          {!confirmReplacement ? (
            <button type="button" className="secondary" onClick={() => setConfirmReplacement(true)}>Replace phone</button>
          ) : (
            <div className="replace-device-confirmation">
              <strong>Are you setting up a different phone?</strong>
              <p>The current phone will keep working until the new phone finishes pairing.</p>
              <div>
                <button type="button" onClick={createCode} disabled={loading}>{loading ? "Creating…" : "Create replacement code"}</button>
                <button type="button" className="secondary" onClick={() => setConfirmReplacement(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : qrDataURL ? (
        <div className="dashboard-pairing">
          <img src={qrDataURL} alt="One-time QR code to connect the patient device" />
          <div>
            <span className="pair-step-label">SCAN WITH THE PATIENT PHONE</span>
            <h3>One scan. No password.</h3>
            {pairingURL && !pairingURL.startsWith("https://") ? (
              <p className="pairing-host-warning" role="alert">
                <strong>Deploy SafeZone with HTTPS before using this code on another phone.</strong>
                Configure PUBLIC_URL with the shared HTTPS address, then generate a new code.
              </p>
            ) : null}
            <ol><li>Open the phone camera</li><li>Scan this QR code</li><li>Allow location on the SafeZone page</li></ol>
            {shortCode ? (
              <div className="manual-code-callout">
                <span>
                  Camera not working? On the patient phone open{" "}
                  <strong>{pairingURL ? `${new URL(pairingURL).host}/patient` : "the SafeZone patient page"}</strong> and type:
                </span>
                <strong className="manual-code">{shortCode.slice(0, 3)} {shortCode.slice(3)}</strong>
              </div>
            ) : null}
            <div className="pair-actions">
              <button type="button" className="secondary" onClick={async () => { await navigator.clipboard.writeText(pairingURL); setCopied(true); }}>{copied ? "Link copied" : "Copy link"}</button>
            </div>
            <small>Expires {new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
          </div>
        </div>
      ) : (
        <div className="pair-empty">
          <div className="pair-illustration" aria-hidden="true"><span>▯</span><i>⌁</i><span>▯</span></div>
          <p>Create a private, one-time QR code. Scan it using the phone {patientName} will carry.</p>
          <button type="button" onClick={createCode} disabled={loading}>{loading ? "Creating code…" : "Create pairing code"}</button>
        </div>
      )}

      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
