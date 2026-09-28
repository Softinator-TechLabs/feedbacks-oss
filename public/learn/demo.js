// Shared, silent walkthroughs. Product frames are captured from a disposable demo.
(() => {
  const base = new URL(".", document.currentScript.src).href;
  const scenes = {
    server: {
      kind: "server",
      frames: [
        { caption: "DevOps installs one shared server.", active: 0 },
        { caption: "The owner creates projects and adds people.", active: 1 },
        { caption: "Everyone connects to the same server URL.", active: 2 },
      ],
    },
    install: {
      kind: "chrome",
      frames: [
        { caption: "Chrome Web Store → Add to Chrome.", active: 0 },
        { caption: "Open Chrome’s Extensions menu.", active: 1 },
        { caption: "Pin Feedbacks. Click its icon to start review.", active: 2 },
      ],
    },
    connect: {
      frames: [
        { image: "connect-1", caption: "In your team’s Help page, copy the server URL." },
        {
          image: "connect-2",
          caption: "Paste it here. Choose Connect to server, then sign in and approve.",
        },
      ],
    },
    project: {
      frames: [
        { image: "project-1", caption: "Owner: create a project for the website." },
        { image: "project-2", caption: "Publish the context your coding agent needs." },
        { image: "project-3", caption: "Add teammates and give them project access." },
      ],
    },
    capture: {
      frames: [
        {
          image: "capture-1",
          caption: "Click the pinned extension. Point at what needs changing.",
        },
        { image: "capture-2", caption: "Right-click. Write the change. Save point." },
        {
          image: "capture-3",
          caption: "Your point is a draft. Choose Review & send when ready.",
        },
      ],
    },
    send: {
      frames: [
        {
          image: "send-1",
          caption: "Review the screenshots and notes. Choose Send feedback.",
        },
        { image: "send-2", caption: "Wait for the upload to finish." },
        { image: "send-3", caption: "The feedback is now on your team’s server." },
      ],
    },
    agent: {
      frames: [
        {
          image: "agent-1",
          caption: "Developer: create your personal key and copy the prompt.",
        },
        {
          image: "agent-2",
          caption: "Paste privately into Codex, Claude Code or Antigravity.",
        },
        {
          kind: "handoff",
          caption:
            "Ask your agent to read the feedback, agree the change, then fix and verify.",
        },
      ],
    },
  };
  class FeedbacksDemo extends HTMLElement {
    static observedAttributes = ["step"];
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.index = 0;
      this.paused = false;
    }
    connectedCallback() {
      this.mount();
    }
    attributeChangedCallback() {
      if (this.isConnected) this.mount();
    }
    disconnectedCallback() {
      this.cleanup?.();
    }
    mount() {
      this.cleanup?.();
      const scene = scenes[this.getAttribute("step")];
      if (!scene) return;
      this.index = 0;
      this.motion = matchMedia("(prefers-reduced-motion: reduce)");
      this.paused = this.motion.matches;
      this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${base}demo.css?v=20260928-2"><figure><div class="screen"></div><div class="foot"><p class="caption"></p><div class="controls"></div></div></figure><dialog aria-label="Full-size screenshot"><button type="button">Close</button><img alt=""></dialog>`;
      const q = (s) => this.shadowRoot.querySelector(s),
        screen = q(".screen"),
        caption = q(".caption"),
        controls = q(".controls"),
        dialog = q("dialog");
      const steps = scene.frames.map((frame, index) => {
        const b = document.createElement("button");
        b.className = "step";
        b.type = "button";
        b.textContent = String(index + 1);
        b.setAttribute("aria-label", frame.caption);
        b.onclick = () => {
          this.paused = true;
          this.index = index;
          render();
          schedule();
        };
        controls.append(b);
        return b;
      });
      const play = document.createElement("button");
      play.type = "button";
      play.className = "play";
      play.onclick = () => {
        this.paused = !this.paused;
        renderControls();
        schedule();
      };
      controls.append(play);
      const pin =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 3 8 0-1 7 4 4H5l4-4-1-7m4 11v7"/></svg>';
      const puzzle =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h3a3 3 0 1 1 6 0h3v6a3 3 0 1 0 0 6v4h-6a3 3 0 1 0-6 0H4v-7a3 3 0 1 0 0-6V4h4"/></svg>';
      const renderControls = () => {
        play.textContent = this.paused ? "Play" : "Pause";
        play.setAttribute(
          "aria-label",
          `${this.paused ? "Play" : "Pause"} ${this.getAttribute("step")} walkthrough`,
        );
        steps.forEach((b, i) => b.setAttribute("aria-pressed", String(i === this.index)));
      };
      const render = () => {
        const f = scene.frames[this.index];
        caption.textContent = f.caption;
        screen.replaceChildren();
        if (f.image) {
          const button = document.createElement("button");
          button.className = "image enter";
          button.type = "button";
          button.setAttribute("aria-label", "Enlarge: " + f.caption);
          const img = document.createElement("img");
          img.src = base + f.image + ".webp";
          img.alt = f.caption;
          img.decoding = "async";
          button.append(img);
          screen.append(button);
          button.onclick = () => {
            this.paused = true;
            renderControls();
            schedule();
            q("dialog img").src = img.src;
            q("dialog img").alt = img.alt;
            dialog.showModal();
          };
        } else {
          const box = document.createElement("div");
          box.className = "diagram enter";
          if (scene.kind === "chrome")
            box.innerHTML = `<div class="browser-bar"><span class="address">Your website</span><span class="icon ${f.active === 1 ? "selected" : ""}">${puzzle}</span>${f.active === 2 ? '<span class="icon selected"><strong>F.</strong></span>' : ""}</div><div class="chrome-card">${f.active === 0 ? '<strong>Feedbacks</strong><p>Chrome Web Store</p><span class="store-action">Add to Chrome</span>' : `<strong>Extensions</strong><div class="extension-row"><span>Feedbacks</span><span class="icon ${f.active === 2 ? "selected" : ""}">${pin}</span></div>`}</div>`;
          else if (scene.kind === "server")
            box.innerHTML = `<div class="sequence">${["DevOps · team server", "Owner · projects & people", "Reviewers + developers · connect"].map((t, i) => `<div class="${i === f.active ? "active" : ""}">${t}<small>${["HTTPS + database + private images", "Project context + member access", "One team URL. Your own account."][i]}</small></div>`).join("")}</div>`;
          else
            box.innerHTML =
              '<div class="agent-note"><strong>In your coding agent</strong><p>Paste your private setup prompt.<br>Verify access, then choose the feedback to fix.</p></div>';
          screen.append(box);
        }
        renderControls();
      };
      let timer,
        visible = false;
      const schedule = () => {
        clearInterval(timer);
        if (visible && !this.paused && !document.hidden)
          timer = setInterval(() => {
            this.index = (this.index + 1) % scene.frames.length;
            render();
          }, 2800);
      };
      const observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (visible && !screen.childElementCount) render();
          schedule();
        },
        { threshold: 0.25 },
      );
      observer.observe(this);
      const visibility = () => schedule();
      document.addEventListener("visibilitychange", visibility);
      const reduce = () => {
        if (this.motion.matches) {
          this.paused = true;
          renderControls();
          schedule();
        }
      };
      this.motion.addEventListener("change", reduce);
      screen.addEventListener("focusin", () => {
        this.paused = true;
        renderControls();
        schedule();
      });
      q("dialog button").onclick = () => dialog.close();
      dialog.addEventListener("close", () => q(".image")?.focus());
      // Start with a readable caption; images load only when the walkthrough is visible.
      caption.textContent = scene.frames[0].caption;
      renderControls();
      this.cleanup = () => {
        clearInterval(timer);
        observer.disconnect();
        document.removeEventListener("visibilitychange", visibility);
        this.motion.removeEventListener("change", reduce);
      };
    }
  }
  if (!customElements.get("feedbacks-demo"))
    customElements.define("feedbacks-demo", FeedbacksDemo);
})();
