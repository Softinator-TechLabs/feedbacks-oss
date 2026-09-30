/* Captured from the real extension renderer; only the recording data is synthetic. */
const moments = [
  {
    time: "00:02",
    detail: "Activity · Click ‘Place order’",
  },
  {
    time: "00:04",
    detail: "Network · POST /checkout · 500",
  },
  {
    time: "00:05",
    detail: "Console · Checkout request failed",
  },
];
class EvidenceDemo extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.index = 0;
    this.playing = false;
    this.root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this.root.innerHTML = `<link rel="stylesheet" href="/learn/evidence.css"><figure class="evidence-demo" aria-label="Actual Feedbacks recording review with sample data">
      <div class="evidence-demo-top"><strong>Recording review</strong><span>Actual UI · sample data</span></div>
      <button class="evidence-open" type="button" aria-label="Enlarge the actual Feedbacks recording review">
        <picture><source media="(max-width: 600px)" srcset="/media/story/recording-mobile-0.webp"><img class="evidence-screen" src="/media/story/recording-desktop-0.webp" width="900" height="655" alt="Actual Feedbacks video review: the captured page, shared timeline, Activity tab and timestamped events."></picture>
        <span class="evidence-expand" aria-hidden="true">Enlarge ↗</span>
      </button>
      <div class="evidence-events" role="group" aria-label="Explore captured moments"><button class="evidence-play" type="button" aria-pressed="false">Play example</button><button type="button" data-moment="0" aria-pressed="true">00:02 <span>Click</span></button><button type="button" data-moment="1" aria-pressed="false">00:04 <span>Request fails</span></button><button type="button" data-moment="2" aria-pressed="false">00:05 <span>Console error</span></button></div>
      <figcaption class="evidence-event" aria-live="polite">Activity · Click ‘Place order’</figcaption>
      <dialog aria-label="Actual Feedbacks recording review"><button class="evidence-close" type="button" autofocus>Close preview</button><img class="evidence-full" src="/media/story/recording-desktop-0.webp" alt="Full size actual Feedbacks recording review with sample events"></dialog>
    </figure>`;
    this.root.querySelector(".evidence-open").addEventListener("click", () => {
      this.pause();
      this.root.querySelector(".evidence-full").src =
        this.root.querySelector(".evidence-screen").currentSrc;
      this.root.querySelector("dialog").showModal();
    });
    this.root
      .querySelector(".evidence-close")
      .addEventListener("click", () => this.root.querySelector("dialog").close());
    for (const layout of ["desktop", "mobile"])
      for (let i = 0; i < moments.length; i++) {
        const preload = new Image();
        preload.src = `/media/story/recording-${layout}-${i}.webp`;
      }
    this.root.querySelectorAll("button[data-moment]").forEach((button) =>
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
    this.root.querySelector(".evidence-event").textContent = moment.detail;
    this.root.querySelector("picture source").srcset =
      `/media/story/recording-mobile-${index}.webp`;
    this.root.querySelector(".evidence-screen").src =
      `/media/story/recording-desktop-${index}.webp`;
    this.root.querySelector(".evidence-screen").alt =
      `Actual Feedbacks recording review at ${moment.time}: ${moment.detail}.`;
    this.root.querySelector(".evidence-full").src =
      `/media/story/recording-desktop-${index}.webp`;
    this.root
      .querySelectorAll("button[data-moment]")
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
