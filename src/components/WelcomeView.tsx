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

/**
 * Adds `is-revealed` to sections as they enter the viewport so the CSS can
 * stagger content in. Falls back to instantly-revealed when IntersectionObserver
 * is unavailable or reduced motion is requested.
 */
function useReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-revealed"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18 }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
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
      <div className="phone-hero-glow" aria-hidden="true" />
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
      <div className="phone-moment-dots">
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

const escalationSteps = [
  { label: "Safe", note: "Inside Home Zone — nothing to do." },
  { label: "Near Boundary", note: "A gentle early heads-up." },
  { label: "Confirming Exit", note: "Navora waits for a second reading." },
  { label: "Needs Attention", note: "Family is notified, once." },
  { label: "Family Responding", note: "One person owns the response." },
  { label: "Resolved", note: "Everyone sees the calm ending." }
] as const;

export function WelcomeView() {
  useReveal();

  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Navora">
        <a href="/" className="brand-lockup">
          <NavoraMark />
          <span>Navora</span>
        </a>
        <div className="landing-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#family">Family response</a>
          <a href="#questions">FAQ</a>
        </div>
        <a href="/onboarding" className="btn btn-nav">Try Navora</a>
      </nav>

      <header className="landing-hero">
        <p className="eyebrow">For families caring for a loved one with dementia</p>
        <h1>
          Know they’re safe.
          <em>Even when you’re not there.</em>
        </h1>
        <p className="landing-hero-sub">
          One calm sentence, a gentle Home Zone boundary, and alerts that tell your whole
          family who’s responding — not just that something happened.
        </p>
        <div className="landing-hero-cta">
          <a href="/onboarding" className="btn btn-lg">
            Start setup <span aria-hidden="true">→</span>
          </a>
          <a href="#how-it-works" className="btn-text">See how it works</a>
        </div>
        <PhoneHeroMockup />
      </header>

      <section className="proof-ribbon" aria-label="Navora product principles" data-reveal>
        <div><strong>1 glance</strong><span>one clear safety state</span></div>
        <div><strong>2 phones</strong><span>no special hardware</span></div>
        <div><strong>1 responder</strong><span>everyone knows who’s going</span></div>
        <div><strong>0 false precision</strong><span>GPS accuracy always shown</span></div>
      </section>

      <section className="scene scene-paper" id="care-confidence" data-reveal>
        <div className="scene-copy">
          <span className="scene-number">01</span>
          <p className="kicker">Peace of mind first</p>
          <h2>Confidence, not coordinates.</h2>
          <p className="scene-lede">
            Families shouldn’t decode GPS logs to answer one human question: <em>are they okay?</em>
          </p>
          <ul className="scene-points">
            <li>
              <span aria-hidden="true">✓</span>
              <div><strong>One sentence</strong><p>“Mary is inside Home Zone.” That’s the whole interface on a quiet day.</p></div>
            </li>
            <li>
              <span aria-hidden="true">✓</span>
              <div><strong>Plain-language signal</strong><p>GPS, freshness, battery, and connection — explained in words, not percentages.</p></div>
            </li>
            <li>
              <span aria-hidden="true">✓</span>
              <div><strong>Honest accuracy</strong><p>Location is approximate — the real radius is always drawn on the map.</p></div>
            </li>
          </ul>
        </div>
        <div className="confidence-art" aria-hidden="true">
          <div className="confidence-halo halo-1" />
          <div className="confidence-halo halo-2" />
          <div className="confidence-core"><span>Mary is home.</span><small>UPDATED JUST NOW</small></div>
          <div className="confidence-signal signal-fresh"><i />GPS<strong>Strong</strong></div>
          <div className="confidence-signal signal-clear"><i />Updated<strong>5 sec ago</strong></div>
          <div className="confidence-signal signal-device"><i />Battery<strong>84%</strong></div>
        </div>
      </section>

      <section className="scene scene-deep" data-reveal>
        <div className="boundary-visual" aria-hidden="true">
          <div className="boundary-map-grid" />
          <span className="boundary-ring ring-outer" />
          <span className="boundary-ring ring-inner" />
          <span className="boundary-house">⌂</span>
          <span className="boundary-person">M</span>
          <div className="boundary-callout">
            <small>NEAR BOUNDARY</small>
            <strong>Mary is approaching the edge</strong>
            <p>No emergency alert yet.</p>
          </div>
        </div>
        <div className="scene-copy">
          <span className="scene-number">02</span>
          <p className="kicker">Thoughtful escalation</p>
          <h2>Warning before panic.</h2>
          <p className="scene-lede">
            Every state has a purpose, and every alert ends in a resolution — never an open loop.
          </p>
          <ol className="escalation-ladder">
            {escalationSteps.map((step, index) => (
              <li key={step.label} className={`ladder-step ladder-${index}`}>
                <span className="ladder-dot" aria-hidden="true" />
                <div><strong>{step.label}</strong><p>{step.note}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="scene scene-paper" id="family" data-reveal>
        <div className="scene-copy">
          <span className="scene-number">03</span>
          <p className="kicker">One care circle</p>
          <h2>One alert. One responder. Everyone aligned.</h2>
          <p className="scene-lede">
            Share one link in the family group chat — everyone joins the same care circle and sees
            the same truth, without a frantic message thread.
          </p>
          <a href="/onboarding" className="btn">
            Create your care circle <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="family-response-art" aria-hidden="true">
          <div className="response-alert">
            <span>!</span>
            <div><small>NAVORA ALERT</small><strong>Mary has left Home Zone</strong><p>2 minutes ago</p></div>
          </div>
          <div className="response-family">
            <div><span className="response-avatar sage">S</span><p><strong>Sarah</strong>I’m going</p><i className="active" /></div>
            <div><span className="response-avatar gold">M</span><p><strong>Mike</strong>I can’t</p><i /></div>
            <div><span className="response-avatar blue">E</span><p><strong>Emma</strong>Alert delivered</p><i /></div>
          </div>
          <div className="response-confirmed">✓ Sarah is responding</div>
        </div>
      </section>

      <section className="how-scene" id="how-it-works" data-reveal>
        <div className="scene-heading">
          <p className="kicker">Start in minutes</p>
          <h2>Three steps. No maze.</h2>
        </div>
        <div className="how-steps">
          <article>
            <span className="how-count">01</span>
            <div className="how-icon" aria-hidden="true">♡</div>
            <h3>Add names</h3>
            <p>So every alert is immediately human — “Mary”, never “the device”.</p>
          </article>
          <article>
            <span className="how-count">02</span>
            <div className="how-icon" aria-hidden="true">⌂</div>
            <h3>Set Home Zone</h3>
            <p>One boundary around where home feels safe. Edit it anytime.</p>
          </article>
          <article>
            <span className="how-count">03</span>
            <div className="how-icon" aria-hidden="true">⌁</div>
            <h3>Connect their phone</h3>
            <p>Scan one secure QR code with the phone your loved one carries.</p>
          </article>
        </div>
      </section>

      <section className="questions-scene" id="questions" data-reveal>
        <div className="scene-heading">
          <p className="kicker">Clear answers</p>
          <h2>Questions families ask first.</h2>
        </div>
        <div className="faq-list">
          <details>
            <summary>How accurate is Navora?<span aria-hidden="true">+</span></summary>
            <p>Navora uses browser GPS. The real accuracy radius is always shown — often ±7 m outdoors, wider near buildings.</p>
          </details>
          <details>
            <summary>Does the patient need a special tracker?<span aria-hidden="true">+</span></summary>
            <p>No. A phone your family already owns, connected with one secure QR code. Nothing for them to learn or configure.</p>
          </details>
          <details>
            <summary>Can several family members watch together?<span aria-hidden="true">+</span></summary>
            <p>Yes. Share one invite link. Everyone sees the same status — and who is responding when it matters.</p>
          </details>
        </div>
      </section>

      <section className="final-cta" data-reveal>
        <NavoraMark />
        <h2>Peace of mind before an emergency happens.</h2>
        <a href="/onboarding" className="btn btn-lg">
          Try Navora <span aria-hidden="true">→</span>
        </a>
      </section>

      <footer className="landing-footer">
        <div className="brand-lockup"><NavoraMark /><span>Navora</span></div>
        <p>Built with care for families navigating dementia.</p>
        <div className="landing-footer-links">
          <a href="#questions">Safety &amp; accuracy</a>
          <a href="/onboarding">Get started</a>
        </div>
      </footer>
    </main>
  );
}
