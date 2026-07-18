import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import { NavoraMark } from "./WelcomeView";
import type { LatLngPoint } from "../types";
import { AuthGate } from "./AuthGate";
import {
  createOrUpdateHousehold as createSupabaseHousehold,
  createPairing as createSupabasePairing,
  fetchZones as fetchSupabaseZones,
  loadPrimaryHousehold,
  saveZone as saveSupabaseZone,
  subscribePush as subscribeSupabasePush,
  supabase,
  supabaseEnabled,
  vapidPublicKey
} from "../lib/supabase";
import { base64ToUint8Array, ensureActiveServiceWorker } from "../lib/push";

type HouseholdProfile = {
  id: string;
  patientName: string;
  caregiverName: string;
  pairedAt: string | null;
};

type ProposedLocation = {
  lat: number;
  lng: number;
  accuracy: number;
};

type OnboardingDraft = {
  step: number;
  caregiverName: string;
  patientName: string;
  relationship: string;
  household: HouseholdProfile;
  location: ProposedLocation | null;
  radius: number;
};

function readOnboardingDraft(): OnboardingDraft | null {
  try {
    const value = window.localStorage.getItem("safezone-onboarding-draft");
    if (!value) return null;
    const draft = JSON.parse(value) as OnboardingDraft;
    return draft.household?.id ? draft : null;
  } catch {
    return null;
  }
}

function circlePoints(center: ProposedLocation, radiusM: number): LatLngPoint[] {
  const earthRadius = 6371000;
  const latitudeRadians = (center.lat * Math.PI) / 180;

  return Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    const north = Math.cos(angle) * radiusM;
    const east = Math.sin(angle) * radiusM;
    return {
      lat: center.lat + (north / earthRadius) * (180 / Math.PI),
      lng:
        center.lng +
        (east / (earthRadius * Math.cos(latitudeRadians))) * (180 / Math.PI)
    };
  });
}

const stepMeta = [
  { number: 1, label: "Names" },
  { number: 2, label: "Home Zone" },
  { number: 3, label: "Their phone" }
] as const;

export function OnboardingFlow() {
  const [initialDraft] = useState(readOnboardingDraft);
  const [step, setStep] = useState(initialDraft?.step || 1);
  const [caregiverName, setCaregiverName] = useState(initialDraft?.caregiverName || "");
  const [patientName, setPatientName] = useState(initialDraft?.patientName || "");
  const [relationship, setRelationship] = useState(initialDraft?.relationship || "Family member");
  const [household, setHousehold] = useState<HouseholdProfile | null>(initialDraft?.household || null);
  const [location, setLocation] = useState<ProposedLocation | null>(initialDraft?.location || null);
  const [radius, setRadius] = useState(initialDraft?.radius || 120);
  const [pairingURL, setPairingURL] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState("");
  const [pairingShortCode, setPairingShortCode] = useState("");
  const [qrDataURL, setQrDataURL] = useState("");
  const [paired, setPaired] = useState(false);
  const [alertsReady, setAlertsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const progress = useMemo(() => `${(step / 3) * 100}%`, [step]);
  const pairingExpired = Boolean(pairingExpiresAt && Date.parse(pairingExpiresAt) <= clock);

  useEffect(() => {
    if (step !== 3 || paired) return;
    const interval = window.setInterval(() => setClock(Date.now()), 5000);
    return () => window.clearInterval(interval);
  }, [paired, step]);

  useEffect(() => {
    if (!supabaseEnabled || initialDraft) return;
    loadPrimaryHousehold()
      .then(async (profile) => {
        if (!profile) return;
        setHousehold({
          id: profile.id,
          patientName: profile.patientName,
          caregiverName: profile.caregiverName,
          pairedAt: profile.pairedAt
        });
        setCaregiverName(profile.caregiverName);
        setPatientName(profile.patientName);
        setRelationship(profile.relationship || "Family member");
        setPaired(Boolean(profile.pairedAt));
        const zones = await fetchSupabaseZones(profile.id).catch(() => []);
        setStep(zones.length > 0 ? 3 : 2);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not restore your family setup."));
  }, [initialDraft]);

  useEffect(() => {
    if (!household) return;
    window.localStorage.setItem(
      "safezone-onboarding-draft",
      JSON.stringify({ step, caregiverName, patientName, relationship, household, location, radius })
    );
  }, [caregiverName, household, location, patientName, radius, relationship, step]);

  useEffect(() => {
    if (!household || step !== 3 || paired || qrDataURL) return;
    createPairing(household.id).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Navora could not create a pairing code.");
    });
  }, [household, paired, qrDataURL, step]);

  useEffect(() => {
    if (!household || step !== 3 || paired) return;

    if (supabaseEnabled && supabase) {
      const client = supabase;
      const channel = client
        .channel(`safezone:onboarding-pairing:${household.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "households", filter: `id=eq.${household.id}` },
          (payload) => {
            if ((payload.new as { paired_at?: string | null }).paired_at) {
              setPaired(true);
            }
          }
        )
        .subscribe();
      return () => {
        client.removeChannel(channel);
      };
    }

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/pairing/status?householdId=${household.id}`);
      if (!response.ok) return;
      const status = (await response.json()) as { paired: boolean };
      if (status.paired) {
        setPaired(true);
        window.clearInterval(interval);
      }
    }, 1800);

    return () => window.clearInterval(interval);
  }, [household, paired, step]);

  async function createFamily() {
    if (!caregiverName.trim() || !patientName.trim()) {
      setError("Please add both names so Navora can make every screen personal.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (supabaseEnabled) {
        const profile = await createSupabaseHousehold({
          householdId: household?.id,
          caregiverName: caregiverName.trim(),
          patientName: patientName.trim(),
          patientRelationship: relationship
        });
        setHousehold({
          id: profile.id,
          patientName: profile.patientName,
          caregiverName: profile.caregiverName,
          pairedAt: profile.pairedAt
        });
      } else {
        const response = await fetch(household ? `/api/households/${household.id}` : "/api/households", {
          method: household ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caregiverName: caregiverName.trim(),
            patientName: patientName.trim(),
            patientRelationship: relationship
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Navora could not create your family.");
        setHousehold(result.household);
      }
      setStep(2);
      if (!location) proposeHomeLocation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Navora could not create your family.");
    } finally {
      setLoading(false);
    }
  }

  function proposeHomeLocation() {
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
        setLoading(false);
      },
      (geolocationError) => {
        setLoading(false);
        setError(
          geolocationError.code === geolocationError.PERMISSION_DENIED
            ? "Location was not allowed. Enable it in browser settings, or draw Home Zone later."
            : "Navora could not determine this device’s location."
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  }

  async function saveHomeZone() {
    if (!household) return;
    if (!location) {
      setStep(3);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (supabaseEnabled) {
        await saveSupabaseZone(household.id, {
          name: "Home Zone",
          color: "#8fd5ae",
          isActive: true,
          points: circlePoints(location, radius)
        });
      } else {
        const response = await fetch("/api/zones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            householdId: household.id,
            name: "Home Zone",
            color: "#8fd5ae",
            isActive: true,
            points: circlePoints(location, radius)
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Navora could not save Home Zone.");
      }
      setStep(3);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Navora could not save Home Zone.");
    } finally {
      setLoading(false);
    }
  }

  async function createPairing(householdId: string) {
    const result = supabaseEnabled
      ? await createSupabasePairing(householdId)
      : await fetch("/api/pairing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ householdId })
        }).then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Navora could not create a pairing code.");
          return payload;
        });

    setPairingURL(result.patientURL);
    setPairingExpiresAt(result.expiresAt);
    setPairingShortCode((result as { shortCode?: string | null }).shortCode || "");
    setQrDataURL(
      await QRCode.toDataURL(result.patientURL, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#092326", light: "#f6f2e9" }
      })
    );
  }

  async function enableAlerts() {
    setLoading(true);
    setError(null);
    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      if (isIOS && !isStandalone) {
        throw new Error("On iPhone, first tap Share → Add to Home Screen. Reopen Navora from the new icon, then enable notifications.");
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support Web Push. Navora will still work while open.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notifications were not allowed. You can enable them later in Settings.");
      }

      const registration = await ensureActiveServiceWorker();
      let publicKey = vapidPublicKey;
      if (!supabaseEnabled) {
        const keyResponse = await fetch("/api/vapid-public-key");
        if (!keyResponse.ok) {
          throw new Error("Notifications are not available on this Navora deployment yet.");
        }
        publicKey = (await keyResponse.json()).publicKey;
      }
      if (!publicKey) {
        throw new Error("Notifications are not available on this Navora deployment yet.");
      }
      const existing = await registration.pushManager.getSubscription();
      const subscriptionObject =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        }));

      if (supabaseEnabled) {
        if (!household?.id) throw new Error("Create your family before enabling notifications.");
        await subscribeSupabasePush(household.id, caregiverName, subscriptionObject);
      } else {
        const subscribeResponse = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            householdId: household?.id,
            caregiverLabel: caregiverName,
            subscriptionObject
          })
        });
        if (!subscribeResponse.ok) {
          const result = await subscribeResponse.json().catch(() => null);
          throw new Error(result?.error || "Navora could not finish notification setup.");
        }
      }
      setAlertsReady(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Alerts could not be enabled.");
    } finally {
      setLoading(false);
    }
  }

  function finish() {
    if (!household) return;
    window.localStorage.setItem("safezone-household-id", household.id);
    window.localStorage.setItem("safezone-caregiver-label", caregiverName.trim());
    window.localStorage.setItem("safezone-patient-name", patientName.trim());
    window.localStorage.setItem("safezone-setup-complete", household.id);
    window.localStorage.removeItem("safezone-onboarding-draft");
    window.location.assign(`/caregiver?household=${household.id}`);
  }

  const stepTitle =
    step === 1
      ? "Let’s make Navora feel like family."
      : step === 2
        ? "Where should home feel safe?"
        : paired
          ? "One final choice."
          : `Connect ${patientName || "their"}’s phone.`;

  const stepLede =
    step === 1
      ? "Names make alerts understandable in stressful moments. Navora uses them only inside your family experience."
      : step === 2
        ? "Navora proposes a boundary around your current location. You stay in control and can edit it anytime."
        : paired
          ? "Choose whether Navora can send boundary alerts, then open your caregiver dashboard."
          : `Open the camera on ${patientName || "their"}’s phone and scan this one-time code. It expires automatically.`;

  return (
    <AuthGate>
      <main className="onboarding-screen">
        <nav className="onboarding-nav">
          <a href="/" className="brand-lockup"><NavoraMark /><span>Navora</span></a>
          <button type="button" className="btn-text" onClick={() => window.location.assign("/")}>Exit setup</button>
        </nav>

        <div className="onboarding-column">
          <ol className="onboarding-stepper" aria-label={`Step ${step} of 3`}>
            {stepMeta.map((item) => (
              <li
                key={item.number}
                className={step === item.number ? "is-current" : step > item.number ? "is-done" : ""}
                aria-current={step === item.number ? "step" : undefined}
              >
                <span className="stepper-dot">{step > item.number ? "✓" : item.number}</span>
                <span className="stepper-label">{item.label}</span>
              </li>
            ))}
            <span className="stepper-track" aria-hidden="true"><i style={{ width: progress }} /></span>
          </ol>

          <header className="onboarding-heading" key={`heading-${step}-${paired}`}>
            <h1>{stepTitle}</h1>
            <p>{stepLede}</p>
          </header>

          <section className="onboarding-card" key={`card-${step}`}>
            {step === 1 ? (
              <div className="onboarding-form">
                <label className="field">
                  <span>Your name</span>
                  <input value={caregiverName} onChange={(event) => setCaregiverName(event.target.value)} placeholder="Sarah" autoFocus />
                </label>
                <label className="field">
                  <span>Loved one’s name</span>
                  <input value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="Mary" />
                </label>
                <label className="field">
                  <span>Your relationship</span>
                  <select value={relationship} onChange={(event) => setRelationship(event.target.value)}>
                    <option>Family member</option>
                    <option>Spouse or partner</option>
                    <option>Professional caregiver</option>
                    <option>Friend</option>
                  </select>
                </label>
                <button type="button" className="btn-step-primary" onClick={createFamily} disabled={loading}>
                  {loading ? "Creating your family…" : "Continue"} <span aria-hidden="true">→</span>
                </button>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="onboarding-form">
                <p className="zone-guidance">
                  <strong>Do this while you are at the home location.</strong> Navora uses this device’s
                  current GPS position as the center of Home Zone.
                </p>
                <div className={`zone-visual ${location ? "located" : ""}`}>
                  <div className="zone-grid" aria-hidden="true" />
                  <span className="zone-radius" style={{ "--zone-scale": Math.min(1.4, radius / 120) } as CSSProperties} />
                  <span className="zone-home" aria-hidden="true">⌂</span>
                  {loading ? <p>Finding this device…</p> : null}
                  {!location && !loading ? (
                    <button type="button" className="secondary" onClick={proposeHomeLocation}>Try location again</button>
                  ) : null}
                </div>
                {location ? (
                  <>
                    <div className="inline-confirmation">
                      <span aria-hidden="true">✓</span>
                      <div>
                        <strong>Current location found</strong>
                        <small>GPS reports an accuracy radius of about {Math.round(location.accuracy)} m</small>
                      </div>
                    </div>
                    <label className="radius-control">
                      <span><strong>Boundary size</strong><b>{radius} m</b></span>
                      <input type="range" min="50" max="300" step="10" value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
                    </label>
                  </>
                ) : null}
                <button type="button" className="btn-step-primary" onClick={saveHomeZone} disabled={loading}>
                  {location ? "Use this Home Zone" : "Continue without a boundary"} <span aria-hidden="true">→</span>
                </button>
                {!location ? (
                  <p className="onboarding-footnote">Boundary alerts remain off until you create Home Zone from the caregiver map.</p>
                ) : null}
                <button type="button" className="btn-text onboarding-back" onClick={() => { setError(null); setStep(1); }}>
                  ← Edit names
                </button>
              </div>
            ) : null}

            {step === 3 && !paired ? (
              <div className="onboarding-form pairing-step">
                {pairingURL && !pairingURL.startsWith("https://") ? (
                  <p className="callout callout-warning" role="alert">
                    <strong>Two-phone pairing needs a deployed HTTPS address.</strong>
                    This local link will not provide reliable location access on another phone.
                    Set PUBLIC_URL to your HTTPS app address, then create a new code.
                  </p>
                ) : null}
                <div className="pairing-layout">
                  <div className={`qr-frame ${pairingExpired ? "expired" : ""}`}>
                    {qrDataURL ? (
                      <img src={qrDataURL} alt="One-time QR code for pairing the patient device" />
                    ) : (
                      <div className="qr-loading">Creating secure code…</div>
                    )}
                  </div>
                  <div className="pairing-side">
                    <ol className="pair-instructions">
                      <li>Open the camera on {patientName || "their"}’s phone</li>
                      <li>Point it at this code</li>
                      <li>Tap the Navora link and confirm</li>
                    </ol>
                    {pairingShortCode ? (
                      <div className="manual-code-callout">
                        <span>
                          Camera not working? On {patientName || "their"}’s phone open{" "}
                          <strong>{pairingURL ? `${new URL(pairingURL).host}/patient` : "the Navora patient page"}</strong>{" "}
                          and type this code:
                        </span>
                        <strong className="manual-code">{pairingShortCode.slice(0, 3)} {pairingShortCode.slice(3)}</strong>
                      </div>
                    ) : null}
                    <div className="pair-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={async () => { await navigator.clipboard.writeText(pairingURL); setCopied(true); }}
                      >
                        {copied ? "Link copied" : "Copy pairing link"}
                      </button>
                      <button
                        type="button"
                        className={pairingExpired ? "" : "secondary"}
                        onClick={() => { setCopied(false); createPairing(household!.id); }}
                      >
                        {pairingExpired ? "Create a fresh code" : "Create a new code"}
                      </button>
                    </div>
                    <small className={`expiry-note ${pairingExpired ? "expired" : ""}`}>
                      {pairingExpired
                        ? "This code has expired. Create a fresh code to continue."
                        : `Code expires at ${pairingExpiresAt ? new Date(pairingExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}`}
                    </small>
                  </div>
                </div>
                <button type="button" className="btn-step-primary" onClick={finish}>
                  Go to caregiver dashboard <span aria-hidden="true">→</span>
                </button>
                <p className="onboarding-footnote">
                  You can skip pairing for now and connect {patientName || "their"}’s phone later from Family.{" "}
                  <a href="/live">Or open the live tracker →</a>
                </p>
                <button type="button" className="btn-text onboarding-back" onClick={() => { setError(null); setStep(2); }}>
                  ← Edit Home Zone
                </button>
              </div>
            ) : null}

            {step === 3 && paired ? (
              <div className="onboarding-form paired-final-step">
                <div className="inline-confirmation success">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>{patientName}’s phone is connected</strong>
                    <small>Location sharing begins after permission is allowed on that phone.</small>
                  </div>
                </div>
                <div className="alert-preview" aria-hidden="true">
                  <span className="alert-app-icon"><NavoraMark /></span>
                  <div>
                    <strong>Navora</strong>
                    <p>{patientName} may have left Home Zone.</p>
                    <small>now</small>
                  </div>
                </div>
                <ul className="alert-benefits">
                  <li><span aria-hidden="true">✓</span><p><strong>Live dashboard warning</strong> while Navora is open</p></li>
                  <li><span aria-hidden="true">✓</span><p><strong>Background notification</strong> after a confirmed crossing</p></li>
                  <li><span aria-hidden="true">✓</span><p><strong>Shared response</strong> so family knows who is helping</p></li>
                </ul>
                {!alertsReady ? (
                  <button type="button" className="btn-step-primary" onClick={enableAlerts} disabled={loading}>
                    {loading ? "Enabling…" : "Enable notifications"}
                  </button>
                ) : (
                  <div className="inline-confirmation success">
                    <span aria-hidden="true">✓</span>
                    <div><strong>Notifications are ready</strong></div>
                  </div>
                )}
                <button type="button" className="btn-text" onClick={finish}>
                  {alertsReady ? "Open caregiver dashboard" : "Use dashboard without background alerts"} →
                </button>
                <p className="onboarding-footnote">
                  <strong>Using iPhone?</strong> Tap Share → Add to Home Screen, reopen Navora from its icon,
                  then enable notifications. Without them, alerts appear only while the dashboard is open.
                </p>
              </div>
            ) : null}

            {error ? <p className="callout callout-error" role="alert">{error}</p> : null}
          </section>

          <p className="onboarding-reassurance">
            <span aria-hidden="true">✓</span>
            {step === 1 && "Three short steps. No technical setup."}
            {step === 2 && "No false precision — the real GPS accuracy stays visible."}
            {step === 3 && (paired ? "You can change alert preferences whenever you need." : "The QR contains a short-lived token, not a permanent password.")}
          </p>
        </div>
      </main>
    </AuthGate>
  );
}
