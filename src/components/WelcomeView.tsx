import { useEffect, useRef, useState } from "react";
import { animate, createTimeline } from "animejs";

export function NavoraMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

const heroMoments = [
  {
    state: "safe",
    label: "Safe",
    title: "Mary is inside Home Zone",
    detail: "Updated just now · ±7 m",
    dot: { left: "42%", top: "54%" },
    ring: 28
  },
  {
    state: "approaching",
    label: "Near Boundary",
    title: "Mary is near the edge",
    detail: "Early warning — no alert yet",
    dot: { left: "58%", top: "46%" },
    ring: 32
  },
  {
    state: "alert",
    label: "Needs Attention",
    title: "Mary left Home Zone",
    detail: "Family notified · location approximate",
    dot: { left: "74%", top: "38%" },
    ring: 40
  },
  {
    state: "responding",
    label: "Family Responding",
    title: "Sarah is taking care of it",
    detail: "Mike and Emma can see who’s handling it",
    dot: { left: "74%", top: "38%" },
    ring: 40
  }
] as const;

function PhoneHeroMockup() {
  const [moment, setMoment] = useState(0);
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const boundaryRef = useRef<HTMLDivElement | null>(null);
  const introPlayed = useRef(false);

  const current = heroMoments[moment];

  useEffect(() => {
    const phone = phoneRef.current;
    const dot = dotRef.current;
    const status = statusRef.current;
    if (!phone || !dot || !status || introPlayed.current) return;
    introPlayed.current = true;

    const timeline = createTimeline({ defaults: { ease: "out(3)" } });
    timeline
      .add(phone, { opacity: [0, 1], translateY: [36, 0], duration: 900 })
      .add(dot, { scale: [0.6, 1], opacity: [0, 1], duration: 700 }, 200)
      .add(status, { opacity: [0, 1], translateY: [18, 0], duration: 650 }, 350);
  }, []);

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    const status = statusRef.current;
    const boundary = boundaryRef.current;
    if (!dot || !ring || !status || !boundary) return;

    animate(dot, {
      left: current.dot.left,
      top: current.dot.top,
      duration: 1100,
      ease: "out(3)"
    });

    animate(ring, {
      width: `${current.ring * 2}px`,
      height: `${current.ring * 2}px`,
      duration: 900,
      ease: "out(2)"
    });

    animate(status, {
      opacity: [0.35, 1],
      translateY: [10, 0],
      duration: 450,
      ease: "out(2)"
    });

    animate(boundary, {
      scale: current.state === "alert" || current.state === "responding" ? [1, 1.03, 1] : 1,
      duration: current.state === "alert" ? 700 : 0,
      ease: "out(2)"
    });
  }, [current]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMoment((value) => (value + 1) % heroMoments.length);
    }, 3400);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="phone-hero-stage" aria-label="Navora product preview">
      <div className={`phone-mockup phone-state-${current.state}`} ref={phoneRef}>
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-screen">
          <div className="phone-topbar">
            <span>Navora</span>
            <span className="phone-live-pill">● Live</span>
          </div>
          <div className="phone-map">
            <div className="phone-map-grid" aria-hidden="true" />
            <div className={`phone-boundary phone-boundary-${current.state}`} ref={boundaryRef} aria-hidden="true" />
            <div className="phone-home" aria-hidden="true">
              <span>⌂</span>
            </div>
            <div className="phone-accuracy-ring" ref={ringRef} aria-hidden="true" />
            <div className="phone-dot" ref={dotRef} aria-label="Mary's location">
              <span>MJ</span>
            </div>
          </div>
          <div className="phone-status" ref={statusRef} key={current.state}>
            <span className={`phone-status-chip chip-${current.state}`}>{current.label}</span>
            <h3>{current.title}</h3>
            <p>{current.detail}</p>
          </div>
          {current.state === "responding" ? (
            <div className="phone-family-banner">
              <span>S</span>
              <div>
                <strong>Sarah is responding</strong>
                <span>Mike viewing · Emma notified</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="phone-moment-dots" aria-hidden="true">
        {heroMoments.map((item, index) => (
          <button
            key={item.state}
            type="button"
            className={moment === index ? "active" : ""}
            onClick={() => setMoment(index)}
            aria-label={`Show ${item.label}`}
          />
        ))}
      </div>
    </div>
  );
}

export function WelcomeView() {
  return (
    <main className="story-site">
      <nav className="story-nav" aria-label="Navora">
        <a href="/" className="brand-lockup"><NavoraMark /><span>Navora</span></a>
        <div className="story-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#family">Family response</a>
          <a href="#questions">FAQ</a>
        </div>
        <a href="/onboarding" className="story-nav-cta">Try Navora</a>
      </nav>

      <section className="landing-hero-simple">
        <p className="landing-eyebrow">For families caring for a loved one with dementia</p>
        <h1>Know they’re safe. Even when you’re not there.</h1>
        <p className="landing-hero-sub">
          Navora is a compassionate safety companion: real-time location, a gentle Home Zone boundary,
          and calm alerts that tell your whole family who’s responding.
        </p>
        <PhoneHeroMockup />
        <div className="landing-hero-cta">
          <a href="/onboarding" className="primary-story-cta">Start setup <span>→</span></a>
          <a href="#how-it-works" className="secondary-story-cta">See how it works</a>
        </div>
        <p className="landing-scroll-cue" aria-hidden="true">Scroll to see how it works</p>
      </section>

      <section className="proof-ribbon" aria-label="Navora product principles">
        <div><strong>At a glance</strong><span>one clear safety state</span></div>
        <div><strong>2 phones</strong><span>no special hardware</span></div>
        <div><strong>1 response</strong><span>who is handling it</span></div>
        <div><strong>0 false precision</strong><span>GPS accuracy always shown</span></div>
      </section>

      <section className="reassurance-scene" id="care-confidence">
        <div className="scene-copy">
          <span className="scene-number">01</span>
          <p className="story-kicker dark"><span /> Peace of mind first</p>
          <h2>Confidence, not coordinates.</h2>
          <p>Families shouldn’t decode GPS logs to answer one human question: are they okay?</p>
          <ul>
            <li><span>✓</span><div><strong>One sentence</strong><p>“Mary is inside Home Zone.”</p></div></li>
            <li><span>✓</span><div><strong>One confidence score</strong><p>GPS, freshness, battery, and connection in plain language.</p></div></li>
            <li><span>✓</span><div><strong>Honest accuracy</strong><p>Location is approximate — always visible on the map.</p></div></li>
          </ul>
        </div>
        <div className="confidence-art">
          <div className="confidence-halo halo-1" />
          <div className="confidence-halo halo-2" />
          <div className="confidence-core"><span>97%</span><small>CONFIDENCE</small></div>
          <div className="confidence-signal signal-fresh"><i />GPS<strong>Strong</strong></div>
          <div className="confidence-signal signal-clear"><i />Updated<strong>5 sec ago</strong></div>
          <div className="confidence-signal signal-device"><i />Battery<strong>84%</strong></div>
        </div>
      </section>

      <section className="boundary-scene">
        <div className="boundary-visual">
          <div className="boundary-map-grid" />
          <span className="boundary-ring ring-outer" />
          <span className="boundary-ring ring-inner" />
          <span className="boundary-house">⌂</span>
          <span className="boundary-person">M</span>
          <div className="boundary-callout"><small>NEAR BOUNDARY</small><strong>Mary is approaching the edge</strong><p>No emergency alert yet.</p></div>
        </div>
        <div className="scene-copy light">
          <span className="scene-number">02</span>
          <p className="story-kicker"><span /> Thoughtful escalation</p>
          <h2>Warning before panic.</h2>
          <div className="escalation-ladder">
            <span>Safe</span><span>↓</span><span>Near Boundary</span><span>↓</span><span>Confirming Exit</span><span>↓</span><span>Needs Attention</span><span>↓</span><span>Family Responding</span><span>↓</span><span>Resolved</span>
          </div>
        </div>
      </section>

      <section className="family-scene" id="family">
        <div className="scene-copy">
          <span className="scene-number">03</span>
          <p className="story-kicker dark"><span /> One care circle</p>
          <h2>One alert. One responder. Everyone aligned.</h2>
          <p>Share one link in the family group chat — everyone joins the same care circle.</p>
          <a href="/onboarding">Create your care circle <span>→</span></a>
        </div>
        <div className="family-response-art">
          <div className="response-alert"><span>!</span><div><small>NAVORA ALERT</small><strong>Mary has left Home Zone</strong><p>2 minutes ago</p></div></div>
          <div className="response-family">
            <div><span className="response-avatar sage">S</span><p><strong>Sarah</strong>I’m going</p><i className="active" /></div>
            <div><span className="response-avatar gold">M</span><p><strong>Mike</strong>I can’t</p><i /></div>
            <div><span className="response-avatar blue">E</span><p><strong>Emma</strong>Alert delivered</p><i /></div>
          </div>
          <div className="response-confirmed">✓ Sarah is responding</div>
        </div>
      </section>

      <section className="how-scene" id="how-it-works">
        <div className="story-section-heading compact">
          <p className="story-kicker"><span /> Start in minutes</p>
          <h2>Three steps. No maze.</h2>
        </div>
        <div className="how-steps">
          <article><span>01</span><div className="how-icon">♡</div><h3>Add names</h3><p>So every alert is immediately human.</p></article>
          <article><span>02</span><div className="how-icon">⌂</div><h3>Set Home Zone</h3><p>One boundary around where home feels safe.</p></article>
          <article><span>03</span><div className="how-icon">⌁</div><h3>Scan & share</h3><p>Pair the patient phone, then share the family link.</p></article>
        </div>
      </section>

      <section className="questions-scene" id="questions">
        <div className="story-section-heading compact">
          <p className="story-kicker"><span /> Clear answers</p>
          <h2>Questions families ask first.</h2>
        </div>
        <div className="faq-list">
          <details><summary>How accurate is Navora?</summary><p>Navora uses browser GPS. The real accuracy radius is always shown — often ±7 m outdoors, wider near buildings.</p></details>
          <details><summary>Does the patient need a special tracker?</summary><p>No. A phone your family already owns, connected with one secure QR code.</p></details>
          <details><summary>Can several family members watch together?</summary><p>Yes. Share one invite link. Everyone sees who is responding.</p></details>
        </div>
      </section>

      <section className="final-story-cta">
        <NavoraMark />
        <h2>Peace of mind before an emergency happens.</h2>
        <a href="/onboarding">Try Navora <span>→</span></a>
      </section>

      <footer className="story-footer">
        <div className="brand-lockup"><NavoraMark /><span>Navora</span></div>
        <p>Built with care for families navigating dementia.</p>
        <div><a href="#questions">Safety & accuracy</a><a href="/onboarding">Get started</a></div>
      </footer>
    </main>
  );
}
