import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import { SafeZoneMark } from "./WelcomeView";
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
      setError(caught instanceof Error ? caught.message : "SafeZone could not create a pairing code.");
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
      setError("Please add both names so SafeZone can make every screen personal.");
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
        if (!response.ok) throw new Error(result.error || "SafeZone could not create your family.");
        setHousehold(result.household);
      }
      setStep(2);
      if (!location) proposeHomeLocation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SafeZone could not create your family.");
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
            : "SafeZone could not determine this device’s location."
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
        if (!response.ok) throw new Error(result.error || "SafeZone could not save Home Zone.");
      }
      setStep(3);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SafeZone could not save Home Zone.");
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
          if (!response.ok) throw new Error(payload.error || "SafeZone could not create a pairing code.");
          return payload;
        });

    setPairingURL(result.patientURL);
    setPairingExpiresAt(result.expiresAt);
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
        throw new Error("On iPhone, first tap Share → Add to Home Screen. Reopen SafeZone from the new icon, then enable notifications.");
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support Web Push. SafeZone will still work while open.");
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
          throw new Error("Notifications are not available on this SafeZone deployment yet.");
        }
        publicKey = (await keyResponse.json()).publicKey;
      }
      if (!publicKey) {
        throw new Error("Notifications are not available on this SafeZone deployment yet.");
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
          throw new Error(result?.error || "SafeZone could not finish notification setup.");
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

    return (
    <AuthGate>
    <main className="onboarding-screen">
      <nav className="onboarding-nav">
        <a href="/" className="brand-lockup"><SafeZoneMark /><span>SafeZone</span></a>
        <span>Family setup</span>
        <a href="/caregiver?demo=1" className="onboarding-demo-link">Try presentation demo</a>
        <button type="button" className="onboarding-exit" onClick={() => window.location.assign("/")}>Exit</button>
      </nav>

      <div className="onboarding-progress" aria-label={`Step ${step} of 3`}>
        <span style={{ width: progress }} />
      </div>

      <section className="onboarding-layout">
        <aside className="onboarding-story">
          <span className="step-count">0{step} / 03</span>
          <p className="eyebrow">
            {step === 1 && "Meet your care circle"}
            {step === 2 && "Create a place of safety"}
            {step === 3 && (paired ? "Finish your safety net" : "Connect the patient device")}
          </p>
          <h1>
            {step === 1 && "Let’s make SafeZone feel like family."}
            {step === 2 && "Where should home feel safe?"}
            {step === 3 && (paired ? "One final choice." : `Connect ${patientName}’s phone.`)}
          </h1>
          <p>
            {step === 1 && "Names make alerts understandable in stressful moments. SafeZone uses them only inside your family experience."}
            {step === 2 && "We propose a boundary around your current location. You stay in control and can edit it anytime."}
            {step === 3 && (paired ? "Choose whether SafeZone can send boundary alerts, then open your caregiver dashboard." : `Open the camera on ${patientName}’s phone and scan this one-time code. It expires automatically.`)}
          </p>
          <div className="onboarding-reassurance">
            <span>✓</span>
            <p>
              <strong>
                {step === 1 && "Simple by design"}
                {step === 2 && "No false precision"}
                {step === 3 && (paired ? "You control notifications" : "One-time secure pairing")}
              </strong>
              {step === 1 && "Three short steps. No technical setup."}
              {step === 2 && "The real GPS accuracy remains visible."}
              {step === 3 && (paired ? "Change alert preferences whenever you need." : "The QR contains a short-lived token, not a permanent password.")}
            </p>
          </div>
        </aside>

        <div className="onboarding-card">
          {step === 1 ? (
            <div className="onboarding-form">
              <div className="form-heading"><span>People</span><h2>Who are we caring for?</h2></div>
              <label><span>Your name</span><input value={caregiverName} onChange={(event) => setCaregiverName(event.target.value)} placeholder="Sarah" autoFocus /></label>
              <label><span>Loved one’s name</span><input value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="Mary" /></label>
              <label>
                <span>Your relationship</span>
                <select value={relationship} onChange={(event) => setRelationship(event.target.value)}>
                  <option>Family member</option><option>Spouse or partner</option><option>Professional caregiver</option><option>Friend</option>
                </select>
              </label>
              <button type="button" className="onboarding-primary" onClick={createFamily} disabled={loading}>
                {loading ? "Creating your family…" : "Continue"} <span>→</span>
              </button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="zone-proposal">
              <div className="form-heading"><span>Home Zone</span><h2>Confirm the starting boundary</h2></div>
              <p className="zone-location-guidance"><strong>Do this while you are at the home location.</strong> SafeZone uses this device’s current GPS position as the center of Home Zone.</p>
              <div className={`zone-visual ${location ? "located" : ""}`}>
                <div className="zone-grid" aria-hidden="true" />
                <span className="zone-radius" style={{ "--zone-scale": Math.min(1.4, radius / 120) } as CSSProperties} />
                <span className="zone-home">⌂</span>
                {loading ? <p>Finding this device…</p> : null}
                {!location && !loading ? <button type="button" onClick={proposeHomeLocation}>Try location again</button> : null}
              </div>
              {location ? (
                <>
                  <div className="location-confirmation">
                    <span>✓</span>
                    <div><strong>Current location found</strong><small>GPS reports an accuracy radius of about {Math.round(location.accuracy)} m</small></div>
                  </div>
                  <label className="radius-control">
                    <span><strong>Boundary size</strong><b>{radius} m</b></span>
                    <input type="range" min="50" max="300" step="10" value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
                  </label>
                </>
              ) : null}
              <button type="button" className="onboarding-primary" onClick={saveHomeZone} disabled={loading}>
                {location ? "Use this Home Zone" : "Continue without a boundary"} <span>→</span>
              </button>
              <button type="button" className="onboarding-back" onClick={() => { setError(null); setStep(1); }}>← Edit names</button>
              {!location ? <p className="boundary-warning">Boundary alerts remain off until you create Home Zone from the caregiver map.</p> : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="pairing-step">
              {!paired ? (
                <>
                  <div className="form-heading"><span>Location phone</span><h2>Scan with {patientName}’s phone</h2></div>
                  {pairingURL && !pairingURL.startsWith("https://") ? (
                    <p className="pairing-host-warning" role="alert">
                      <strong>Two-phone pairing needs a deployed HTTPS address.</strong>
                      This local link will not provide reliable location access on another phone. Set PUBLIC_URL to your HTTPS app address, then create a new code.
                    </p>
                  ) : null}
                  <div className={`qr-frame ${pairingExpired ? "expired" : ""}`}>
                    {qrDataURL ? <img src={qrDataURL} alt="One-time QR code for pairing the patient device" /> : <div className="qr-loading">Creating secure code…</div>}
                  </div>
                  <ol className="pair-instructions"><li>Open the camera on {patientName}’s phone</li><li>Point it at this code</li><li>Tap the SafeZone link and confirm</li></ol>
                  <div className="pair-actions">
                    <button type="button" className="secondary" onClick={async () => { await navigator.clipboard.writeText(pairingURL); setCopied(true); }}>{copied ? "Link copied" : "Copy pairing link"}</button>
                    <button type="button" className={pairingExpired ? "" : "secondary"} onClick={() => { setCopied(false); createPairing(household!.id); }}>{pairingExpired ? "Create a fresh code" : "Create a new code"}</button>
                  </div>
                  <button type="button" className="onboarding-primary" onClick={finish}>
                    Go to caregiver dashboard <span>→</span>
                  </button>
                  <a className="finish-link" href="/live">
                    Or open live tracker (works without pairing) →
                  </a>
                  <p className="ios-onboarding-note">Skip pairing for now and open the dashboard. You can connect {patientName}’s phone later from Family.</p>
                  <button type="button" className="onboarding-back" onClick={() => { setError(null); setStep(2); }}>← Edit Home Zone</button>
                  <small className={`expiry-note ${pairingExpired ? "expired" : ""}`}>
                    {pairingExpired ? "This code has expired. Create a fresh code to continue." : `Code expires at ${pairingExpiresAt ? new Date(pairingExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}`}
                  </small>
                </>
              ) : (
                <div className="paired-final-step">
                  <div className="pair-success compact"><span>✓</span><div><strong>{patientName}’s phone is connected</strong><p>Location sharing begins after permission is allowed on that phone.</p></div></div>
                  <div className="form-heading"><span>Recommended</span><h2>Get alerts away from the dashboard</h2></div>
                  <div className="alert-preview">
                    <span className="alert-app-icon"><SafeZoneMark /></span>
                    <div><strong>SafeZone</strong><p>{patientName} may have left Home Zone.</p><small>now</small></div>
                  </div>
                  <div className="alert-benefits">
                    <p><span>✓</span><strong>Live dashboard warning</strong> while SafeZone is open</p>
                    <p><span>✓</span><strong>Background notification</strong> after a confirmed crossing</p>
                    <p><span>✓</span><strong>Shared response</strong> so family knows who is helping</p>
                  </div>
                  {!alertsReady ? <button type="button" className="onboarding-primary" onClick={enableAlerts} disabled={loading}>{loading ? "Enabling…" : "Enable notifications"}</button> : <div className="alerts-enabled"><span>✓</span><strong>Notifications are ready</strong></div>}
                  <button type="button" className="finish-link" onClick={finish}>{alertsReady ? "Open caregiver dashboard" : "Use dashboard without background alerts"} →</button>
                  <p className="ios-onboarding-note"><strong>Using iPhone?</strong> Tap Share → Add to Home Screen, reopen SafeZone from its icon, then enable notifications. Without notifications, alerts appear only while the dashboard is open.</p>
                </div>
              )}
            </div>
          ) : null}

          {error ? <p className="onboarding-error" role="alert">{error}</p> : null}
        </div>
      </section>
    </main>
    </AuthGate>
  );
}
