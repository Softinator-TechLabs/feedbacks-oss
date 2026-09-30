/* Small, local educational diagram. Synthetic events; never live telemetry. */
const moments = [
  {
    time: "00:02",
    title: "A click starts the story.",
    detail: "Activity · Click ‘Place order’",
    state: "Place order",
    note: "The action and its selected element stay together.",
  },
  {
    time: "00:04",
    title: "Find the request that failed.",
    detail: "Network · POST /checkout · 500",
    state: "Something went wrong",
    note: "Inspect the captured request at that moment.",
  },
  {
    time: "00:05",
    title: "Give the error its context.",
    detail: "Console · Checkout request failed",
    state: "Something went wrong",
    note: "Video, activity and diagnostics share one timeline.",
  },
];
class EvidenceDemo extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.index = 0;
    this.playing = false;
    this.root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this.root.innerHTML = `<link rel="stylesheet" href="/learn/evidence.css"><div class="evidence-demo" role="group" aria-label="Interactive example of a recording timeline">
      <div class="evidence-demo-top"><span>Explore a recording</span><span>Illustrative example</span></div>
      <div class="evidence-scene">
        <div class="evidence-browser"><div class="evidence-address">shop.example / checkout</div><div class="evidence-checkout"><span class="evidence-shop">GOOD FORM</span><div class="evidence-order"><img src="/media/studio-chair.png" width="180" height="120" alt="Cream and orange studio chair in a fictional shop" /><div><strong>Studio chair</strong><span>Ready for a new home.</span></div></div><div class="evidence-action">Place order</div><svg class="evidence-pointer" viewBox="0 0 24 28" aria-hidden="true"><path d="m3 2 17 15-9 1-4 8Z" /></svg></div></div>
        <div class="evidence-inspector"><span class="evidence-clock">00:02</span><strong class="evidence-event">Activity · Click ‘Place order’</strong><p class="evidence-explanation">The action and its selected element stay together.</p><div class="evidence-channels"><span>Activity</span><span>Network</span><span>Console</span></div></div>
      </div>
      <div class="evidence-track" aria-hidden="true"><span class="evidence-progress"></span><i></i><i></i><i></i></div>
      <div class="evidence-events" role="group" aria-label="Choose a moment"><button type="button" data-moment="0" aria-pressed="true"><span>00:02</span>Click</button><button type="button" data-moment="1" aria-pressed="false"><span>00:04</span>Request fails</button><button type="button" data-moment="2" aria-pressed="false"><span>00:05</span>Console error</button></div>
      <div class="evidence-bottom"><button class="evidence-play" type="button" aria-pressed="false">Play example</button><span class="evidence-caption" aria-live="polite">A click starts the story.</span></div>
    </div>`;
    this.root.querySelectorAll("[data-moment]").forEach((button) =>
      button.addEventListener("click", () => {
        this.pause();
        this.show(Number(button.dataset.moment));
      }),
    );
    this.root
      .querySelector(".evidence-play")
      .addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    this.visibility = () => {
      if (document.hidden) this.pause();
    };
    document.addEventListener("visibilitychange", this.visibility);
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    this.motionChange = () => {
      if (this.reduced.matches) this.pause();
    };
    this.reduced.addEventListener("change", this.motionChange);
    this.observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) this.pause();
    });
    this.observer.observe(this);
    this.show(0);
  }
  show(index) {
    this.index = index;
    const moment = moments[index];
    this.root.querySelector(".evidence-demo").dataset.moment = String(index);
    for (const [selector, text] of Object.entries({
      ".evidence-clock": moment.time,
      ".evidence-event": moment.detail,
      ".evidence-explanation": moment.note,
      ".evidence-action": moment.state,
      ".evidence-caption": moment.title,
    }))
      this.root.querySelector(selector).textContent = text;
    this.root
      .querySelectorAll("[data-moment]")
      .forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  }
  play() {
    this.playing = true;
    const button = this.root.querySelector(".evidence-play");
    button.textContent = "Pause example";
    button.setAttribute("aria-pressed", "true");
    this.timer = setInterval(() => this.show((this.index + 1) % moments.length), 2400);
  }
  pause() {
    clearInterval(this.timer);
    this.playing = false;
    const button = this.root.querySelector(".evidence-play");
    if (button) {
      button.textContent = "Play example";
      button.setAttribute("aria-pressed", "false");
    }
  }
  disconnectedCallback() {
    this.pause();
    document.removeEventListener("visibilitychange", this.visibility);
    this.reduced?.removeEventListener("change", this.motionChange);
    this.observer?.disconnect();
    this.initialized = false;
  }
}
// Hydrate the static docs first; upgrading earlier lets Vue replace demo controls.
const register = () => {
  if (!customElements.get("feedbacks-evidence"))
    customElements.define("feedbacks-evidence", EvidenceDemo);
};
if (document.readyState === "complete") register();
else window.addEventListener("load", register, { once: true });
