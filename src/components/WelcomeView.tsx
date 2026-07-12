import { useEffect, useState } from "react";

export function SafeZoneMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

const demoMoments = [
  {
    state: "safe",
    label: "INSIDE HOME ZONE",
    title: "Mary’s latest location is at home",
    detail: "Updated just now · about 7 m accuracy",
    note: "Everything looks good based on the latest phone update."
  },
  {
    state: "approaching",
    label: "APPROACHING",
    title: "Mary is near the boundary",
    detail: "A live dashboard warning before a confirmed crossing",
    note: "No push alert yet. Connected dashboards show the early warning."
  },
  {
    state: "alert",
    label: "ACTION NEEDED",
    title: "Mary has left Home Zone",
    detail: "Boundary crossing confirmed",
    note: "Every caregiver receives one clear, shared alert."
  },
  {
    state: "responding",
    label: "FAMILY RESPONDING",
    title: "Sarah is taking care of it",
    detail: "Mike and Emma can see the response",
    note: "No duplicate calls. No frantic group-text thread."
  }
] as const;

function LiveProductDemo() {
  const [moment, setMoment] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      setMoment((current) => (current + 1) % demoMoments.length);
    }, 3200);
    return () => window.clearInterval(interval);
  }, [playing]);

  const current = demoMoments[moment];

  function playFromStart() {
    setMoment(0);
    setPlaying(true);
    document.getElementById("live-product-demo")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="landing-demo-wrap" id="live-product-demo">
      <div className="landing-demo-chrome">
        <span><i /> LIVE PRODUCT STORY</span>
        <span>Simulated movement · Real SafeZone states</span>
        <button type="button" onClick={() => setPlaying((value) => !value)}>
          {playing ? "Pause" : "Play"}
        </button>
      </div>
      <div className={`landing-live-demo demo-${current.state}`}>
        <div className="landing-map-scene">
          <div className="street-grid" aria-hidden="true" />
          <div className="demo-home-label"><span>⌂</span><strong>Home Zone</strong></div>
          <div className="demo-boundary" aria-hidden="true" />
          <div className="demo-trail" aria-hidden="true" />
          <div className="demo-person-dot" aria-label="Mary’s simulated location">
            <span>MJ</span>
            <i />
          </div>
          <div className="map-honesty-pill">◎ Accuracy radius shown</div>
        </div>
        <div className="landing-status-panel">
          <div className="demo-person-row">
            <span className="demo-avatar">MJ</span>
            <div><small>YOUR LOVED ONE</small><strong>Mary Johnson</strong></div>
            <span className="demo-live-dot">● Live</span>
          </div>
          <div className="demo-status-copy" key={current.state}>
            <span className="demo-state-icon" aria-hidden="true">
              {current.state === "safe" ? "✓" : current.state === "approaching" ? "…" : current.state === "alert" ? "!" : "↗"}
            </span>
            <small>{current.label}</small>
            <h3>{current.title}</h3>
            <p>{current.detail}</p>
          </div>
          <div className="demo-reassurance">{current.note}</div>
          <div className="demo-moment-nav" aria-label="Demo moments">
            {demoMoments.map((item, index) => (
              <button
                type="button"
                key={item.state}
                onClick={() => { setMoment(index); setPlaying(false); }}
                className={moment === index ? "active" : ""}
                aria-label={`Show ${item.label.toLowerCase()} state`}
              />
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="replay-story-button" onClick={playFromStart}>Replay product story</button>
    </div>
  );
}

export function WelcomeView() {
  return (
    <main className="story-site">
      <nav className="story-nav" aria-label="SafeZone">
        <a href="/" className="brand-lockup"><SafeZoneMark /><span>SafeZone</span></a>
        <div className="story-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#care-confidence">Care Confidence</a>
          <a href="/live">Live tracker</a>
          <a href="/caregiver?demo=1">Dashboard</a>
        </div>
        <a href="/live" className="story-nav-cta">Start tracking</a>
      </nav>

      <section className="story-hero">
        <div className="story-hero-copy">
          <p className="story-kicker"><span /> A calmer way to care</p>
          <h1>Know they’re safe.<br /><em>Before worry takes over.</em></h1>
          <p>
            SafeZone turns two phones your family already owns into a shared safety net for dementia care—without expensive trackers or complicated dashboards.
          </p>
          <div className="story-actions">
            <a href="/live" className="primary-story-cta">Start tracking <span>→</span></a>
            <a href="/caregiver?demo=1" className="secondary-story-cta"><span>▶</span> Watch the live story</a>
          </div>
          <div className="hero-trust">
            <span>✓ No special hardware</span>
            <span>✓ Free web platform</span>
            <span>✓ GPS accuracy always visible</span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-orbit orbit-a" />
          <div className="hero-orbit orbit-b" />
          <div className="hero-center-mark"><SafeZoneMark /></div>
          <div className="hero-family-node node-caregiver"><span>S</span><strong>Sarah</strong><small>Caregiver</small></div>
          <div className="hero-family-node node-patient"><span>M</span><strong>Mary</strong><small>Safe at home</small></div>
          <div className="hero-signal signal-one">Location current</div>
          <div className="hero-signal signal-two">Family connected</div>
          <svg viewBox="0 0 600 600" aria-hidden="true">
            <path d="M110 350C178 240 220 155 302 150s135 90 190 190" />
            <path d="M122 370c87 84 132 110 207 74 66-32 84-92 155-112" />
          </svg>
        </div>
      </section>

      <section className="proof-ribbon" aria-label="SafeZone product principles">
        <div><strong>At a glance</strong><span>understand the current safety state</span></div>
        <div><strong>2 devices</strong><span>using phones your family already owns</span></div>
        <div><strong>1 shared truth</strong><span>for every connected caregiver</span></div>
        <div><strong>0 false precision</strong><span>real GPS accuracy stays visible</span></div>
      </section>

      <section className="demo-story-section">
        <div className="story-section-heading">
          <p className="story-kicker"><span /> See the product, not a promise</p>
          <h2>From reassurance to action.<br />Without the panic in between.</h2>
          <p>This demonstration is simulated and clearly labeled. Every state mirrors the real server-side safety flow.</p>
        </div>
        <LiveProductDemo />
      </section>

      <section className="reassurance-scene" id="care-confidence">
        <div className="scene-copy">
          <span className="scene-number">01</span>
          <p className="story-kicker dark"><span /> Reassurance first</p>
          <h2>The first three seconds matter most.</h2>
          <p>Caregivers should never interpret coordinates, battery numbers, and connection logs just to answer one human question.</p>
          <ul>
            <li><span>✓</span><div><strong>One clear safety sentence</strong><p>“Mary is inside Home Zone.”</p></div></li>
            <li><span>✓</span><div><strong>One confidence signal</strong><p>Freshness, accuracy, connection, and battery become understandable.</p></div></li>
            <li><span>✓</span><div><strong>Details only when requested</strong><p>The technology stays available without becoming the experience.</p></div></li>
          </ul>
        </div>
        <div className="confidence-art">
          <div className="confidence-halo halo-1" />
          <div className="confidence-halo halo-2" />
          <div className="confidence-core"><span>✓</span><small>TRACKING<br />HEALTH</small></div>
          <div className="confidence-signal signal-fresh"><i />Location fresh<strong>just now</strong></div>
          <div className="confidence-signal signal-clear"><i />GPS clarity<strong>about 7 m</strong></div>
          <div className="confidence-signal signal-device"><i />Patient device<strong>84% battery</strong></div>
        </div>
      </section>

      <section className="boundary-scene">
        <div className="boundary-visual">
          <div className="boundary-map-grid" />
          <span className="boundary-ring ring-outer" />
          <span className="boundary-ring ring-inner" />
          <span className="boundary-house">⌂</span>
          <span className="boundary-person">M</span>
          <div className="boundary-callout"><small>GENTLE HEADS-UP</small><strong>Mary is approaching the boundary</strong><p>No emergency alert yet.</p></div>
        </div>
        <div className="scene-copy light">
          <span className="scene-number">02</span>
          <p className="story-kicker"><span /> Thoughtful escalation</p>
          <h2>A warning before the emergency.</h2>
          <p>Binary alerts create panic and fatigue. SafeZone uses a deliberate escalation curve designed around what the family needs next.</p>
          <div className="escalation-steps">
            <div><span>1</span><strong>Approaching</strong><p>A quiet cue near the edge.</p></div>
            <div><span>2</span><strong>Confirming</strong><p>A short grace period avoids false alarms.</p></div>
            <div><span>3</span><strong>Alert</strong><p>A clear action state shared with family.</p></div>
          </div>
        </div>
      </section>

      <section className="family-scene" id="family">
        <div className="scene-copy">
          <span className="scene-number">03</span>
          <p className="story-kicker dark"><span /> One care circle</p>
          <h2>One alert. One person responding. Everyone informed.</h2>
          <p>SafeZone replaces uncertainty and duplicate calls with a single shared response state.</p>
          <a href="/onboarding">Create your care circle <span>→</span></a>
        </div>
        <div className="family-response-art">
          <div className="response-alert"><span>!</span><div><small>SAFEZONE ALERT</small><strong>Mary has left Home Zone</strong><p>2 minutes ago</p></div></div>
          <div className="response-family">
            <div><span className="response-avatar sage">S</span><p><strong>Sarah</strong>Responding now</p><i className="active" /></div>
            <div><span className="response-avatar gold">M</span><p><strong>Mike</strong>Currently viewing</p><i /></div>
            <div><span className="response-avatar blue">E</span><p><strong>Emma</strong>Alert delivered</p><i /></div>
          </div>
          <div className="response-confirmed">✓ Sarah is taking care of it</div>
        </div>
      </section>

      <section className="how-scene" id="how-it-works">
        <div className="story-section-heading compact">
          <p className="story-kicker"><span /> Start in minutes</p>
          <h2>One path. Three human steps.</h2>
          <p>No account maze. No second setup choice. No technical vocabulary.</p>
        </div>
        <div className="how-steps">
          <article><span>01</span><div className="how-icon">♡</div><h3>Tell us who you care for</h3><p>Add your name and your loved one’s name so every message is immediately understandable.</p></article>
          <article><span>02</span><div className="how-icon">⌂</div><h3>Confirm Home Zone</h3><p>SafeZone proposes a boundary from your location. Adjust it, see the accuracy, and confirm.</p></article>
          <article><span>03</span><div className="how-icon">⌁</div><h3>Scan once to connect</h3><p>Use the patient phone to scan a secure, expiring QR code. Location sharing begins only after consent.</p></article>
        </div>
      </section>

      <section className="dashboard-story">
        <div className="story-section-heading compact">
          <p className="story-kicker"><span /> Caregiver visibility</p>
          <h2>Everything important.<br />Nothing that creates more work.</h2>
        </div>
        <div className="dashboard-showcase">
          <aside>
            <div className="showcase-brand"><SafeZoneMark /> SafeZone</div>
            <span className="active">⌂ Overview</span><span>◎ Live Map</span><span>↗ Activity</span><span>♧ Family</span><span>⚙ Settings</span>
          </aside>
          <div className="showcase-main">
            <div className="showcase-header"><div><small>WELCOME BACK, SARAH</small><strong>Mary at a glance</strong></div><span>● Live</span></div>
            <div className="showcase-grid">
              <div className="showcase-safety"><small>INSIDE HOME ZONE</small><strong>Mary’s latest location is at home</strong><p>Subscribed caregivers will be notified if a confirmed crossing is reported.</p></div>
              <div className="showcase-confidence"><span>✓</span><div><small>TRACKING HEALTH</small><strong>All signals clear</strong><p>Location is recent and reporting normally.</p></div></div>
              <div className="showcase-map"><span className="showcase-zone" /><span className="showcase-dot">M</span><small>Home Zone</small></div>
              <div className="showcase-family"><small>FAMILY</small><strong>2 caregivers connected</strong><div><span>S</span><span>M</span></div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="questions-scene" id="questions">
        <div className="story-section-heading compact">
          <p className="story-kicker"><span /> Clear answers</p>
          <h2>Questions families ask first.</h2>
        </div>
        <div className="faq-list">
          <details><summary>How accurate is SafeZone?</summary><p>SafeZone uses the patient phone’s browser-provided GPS. Modern devices may reach roughly 3–8 meters outdoors, but accuracy worsens near buildings and indoors. The real accuracy radius is always shown.</p></details>
          <details><summary>Does the patient need a special tracker?</summary><p>No. SafeZone uses a phone the family already owns. The patient device is connected through one secure, expiring QR code.</p></details>
          <details><summary>Will it work when the browser is closed?</summary><p>Web Push can deliver alerts after setup, but browser background location is constrained by each operating system. SafeZone does not claim native-app background guarantees.</p></details>
          <details><summary>Can several family members watch together?</summary><p>Yes. Caregivers can see who is viewing and who has taken responsibility during an alert.</p></details>
        </div>
      </section>

      <section className="final-story-cta">
        <SafeZoneMark />
        <p className="story-kicker"><span /> A little less worry starts here</p>
        <h2>Give your family one shared sense of calm.</h2>
        <p>Set up SafeZone using the devices you already own.</p>
        <a href="/onboarding">Start tracking <span>→</span></a>
      </section>

      <footer className="story-footer">
        <div className="brand-lockup"><SafeZoneMark /><span>SafeZone</span></div>
        <p>Built with care for families navigating dementia.</p>
        <div><a href="#questions">Safety & accuracy</a><a href="/caregiver?demo=1">Presentation mode</a></div>
      </footer>
    </main>
  );
}
