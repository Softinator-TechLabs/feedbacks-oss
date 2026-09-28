// Shared, silent walkthroughs. Product frames are captured from a disposable demo.
(() => {
  const base = new URL(".", document.currentScript.src).href;
  const players = new Set();
  const motionControls = new Set();
  let motionChoice;
  try {
    motionChoice = sessionStorage.getItem("feedbacks-motion");
  } catch {}
  let allPaused =
    motionChoice === "paused" ||
    (!motionChoice && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const updateMotionControls = () => {
    const paused = players.size
      ? [...players].every((player) => player.paused)
      : allPaused;
    document.documentElement.dataset.feedbacksMotion = paused ? "paused" : "playing";
    motionControls.forEach((control) => control.render(paused));
  };
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => {
    if (!motionChoice) {
      allPaused = event.matches;
      players.forEach((player) => player.setPlaybackPaused?.(allPaused));
      updateMotionControls();
    }
  });
  function setAllPaused(paused) {
    allPaused = paused;
    motionChoice = paused ? "paused" : "playing";
    try {
      sessionStorage.setItem("feedbacks-motion", motionChoice);
    } catch {}
    players.forEach((player) => player.setPlaybackPaused?.(paused));
    updateMotionControls();
  }
  class FeedbacksMotionControl extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      this.setAttribute("data-control", "");
      this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${base}demo.css?v=20260928-4"><button type="button" class="motion-toggle"><svg viewBox="0 0 16 16" aria-hidden="true"><path/></svg><span></span></button>`;
      this.shadowRoot.querySelector("button").onclick = () => {
        const playing = [...players].some((player) => !player.paused);
        setAllPaused(playing || (!players.size && !allPaused));
      };
      motionControls.add(this);
      updateMotionControls();
    }
    disconnectedCallback() {
      motionControls.delete(this);
    }
    render(paused) {
      const button = this.shadowRoot.querySelector("button");
      button.setAttribute("aria-label", `${paused ? "Play" : "Pause"} all animations`);
      button.querySelector("span").textContent = paused ? "Play all" : "Pause all";
      button
        .querySelector("path")
        .setAttribute("d", paused ? "M4 2 13 8 4 14Z" : "M5 2V14M11 2V14");
    }
  }
  customElements.define("feedbacks-motion-control", FeedbacksMotionControl);
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
        { image: "project-1", caption: "Add your website. Create the project." },
        { image: "project-2", caption: "Publish the context your coding agent needs." },
        { image: "project-3", caption: "Add teammates and give them project access." },
      ],
    },
    capture: {
      frames: [
        {
          image: "capture-1",
          caption: "Right-click the element you want to change.",
        },
        { image: "capture-2", caption: "Write what should change. Choose Save point." },
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
        { image: "send-2", caption: "Sent. Open the feedback on your team’s server." },
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
  // Coordinates use the original capture pixels, so the cursor and text stay
  // attached to the real controls at every responsive size.
  const actions = {
    "capture-1": {
      size: [810, 680],
      points: [
        [0, 650, 460],
        [0.28, 145, 118],
      ],
      clicks: [[0.38, 145, 118, "right"]],
      mark: [24, 68, 249, 97],
    },
    "capture-2": {
      size: [810, 680],
      points: [
        [0, 90, 115],
        [0.16, 218, 280],
        [0.7, 218, 280],
        [0.84, 259, 478],
      ],
      clicks: [
        [0.19, 218, 280],
        [0.88, 259, 478],
      ],
      type: {
        box: [176, 248, 565, 153],
        x: 184,
        y: 283,
        font: 28,
        line: 42,
        lines: ["Make this button darker so it’s easier to", "find."],
        from: 0.25,
        to: 0.68,
      },
      mark: [164, 439, 186, 78],
    },
    "capture-3": {
      size: [1800, 1480],
      points: [
        [0, 1140, 880],
        [0.45, 1580, 1410],
      ],
      clicks: [[0.6, 1580, 1410]],
      mark: [1455, 1360, 290, 80],
    },
    "connect-1": {
      size: [1362, 438],
      points: [
        [0, 460, 340],
        [0.4, 1210, 230],
      ],
      clicks: [[0.52, 1210, 230]],
      type: {
        box: [42, 200, 960, 59],
        x: 49,
        y: 240,
        font: 30,
        line: 36,
        lines: ["https://feedback.example.com"],
        from: 0,
        to: 0.01,
      },
      mark: [1062, 185, 295, 88],
    },
    "connect-2": {
      size: [840, 1120],
      points: [
        [0, 735, 338],
        [0.13, 208, 486],
        [0.65, 208, 486],
        [0.82, 375, 770],
      ],
      clicks: [
        [0.16, 208, 486],
        [0.87, 375, 770],
      ],
      type: {
        box: [48, 450, 633, 63],
        x: 57,
        y: 491,
        font: 24,
        line: 32,
        lines: ["https://feedback.example.com"],
        from: 0.23,
        to: 0.64,
      },
      mark: [34, 731, 671, 81],
    },
    "project-1": {
      size: [1640, 1400],
      points: [
        [0, 1240, 650],
        [0.16, 180, 699],
        [0.67, 180, 699],
        [0.84, 187, 956],
      ],
      clicks: [
        [0.2, 180, 699],
        [0.9, 187, 956],
      ],
      type: {
        box: [71, 672, 1470, 134],
        x: 81,
        y: 708,
        font: 28,
        line: 36,
        lines: ["https://example.com"],
        from: 0.27,
        to: 0.62,
      },
      mark: [56, 916, 264, 84],
    },
    "project-2": {
      size: [1640, 1400],
      points: [
        [0, 1230, 752],
        [0.14, 180, 911],
        [0.72, 180, 911],
        [0.86, 195, 1238],
      ],
      clicks: [
        [0.19, 180, 911],
        [0.9, 195, 1238],
      ],
      type: {
        box: [70, 886, 1470, 250],
        x: 81,
        y: 919,
        font: 28,
        line: 39,
        lines: [
          "Good Form is our furniture shop. Keep keyboard navigation working.",
          "Test at the reported screen size.",
        ],
        from: 0.24,
        to: 0.73,
      },
      mark: [55, 1197, 282, 80],
    },
    "project-3": {
      size: [1640, 1400],
      points: [
        [0, 1060, 892],
        [0.4, 169, 580],
      ],
      clicks: [[0.52, 169, 580]],
      mark: [55, 540, 238, 80],
    },
    "send-1": {
      size: [1640, 1400],
      points: [
        [0, 734, 361],
        [0.32, 1200, 211],
        [0.59, 1474, 65],
      ],
      clicks: [[0.7, 1474, 65]],
      mark: [1341, 20, 266, 87],
    },
    "send-2": {
      size: [1640, 1400],
      points: [
        [0, 510, 810],
        [0.43, 976, 741],
      ],
      clicks: [[0.6, 976, 741]],
      mark: [884, 715, 169, 42],
    },
    "send-3": { size: [1640, 1400], points: [], clicks: [], mark: [98, 738, 708, 100] },
    "agent-1": {
      size: [1338, 508],
      points: [
        [0, 1060, 180],
        [0.38, 240, 293],
      ],
      clicks: [[0.5, 240, 293]],
      mark: [3, 252, 429, 84],
    },
    "agent-2": { size: [1338, 724], points: [], clicks: [], mark: [0, 409, 684, 100] },
  };
  Object.assign(actions["capture-3"], { view: [1040, 750, 760, 730] });
  Object.assign(actions["connect-1"], { view: [1040, 160, 340, 150] });
  Object.assign(actions["connect-2"], { view: [15, 355, 720, 510] });
  Object.assign(actions["project-1"], { view: [35, 600, 835, 455] });
  Object.assign(actions["project-2"], { view: [35, 795, 850, 535] });
  actions["project-2"].type.lines = [
    "Good Form is our furniture shop.",
    "Keep keyboard navigation working.",
    "Test at the reported screen size.",
  ];
  Object.assign(actions["project-3"], { view: [35, 375, 935, 600] });
  Object.assign(actions["send-2"], { view: [490, 335, 655, 485] });
  Object.assign(actions["send-3"], { view: [65, 696, 790, 675] });
  Object.assign(actions["agent-1"], { view: [0, 220, 800, 215] });
  Object.assign(actions["agent-2"], { view: [0, 390, 820, 170] });
  const duration = 3600;
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const ns = "http://www.w3.org/2000/svg";
  const svgNode = (tag, attrs, parent) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    parent?.append(el);
    return el;
  };
  function actionLayer(screen, frame, scene) {
    let action = actions[frame.image];
    if (!action) {
      const width = screen.clientWidth,
        height = screen.clientHeight;
      const target = screen.querySelector(
        scene.kind === "server"
          ? ".sequence .active"
          : scene.kind === "chrome"
            ? frame.active === 0
              ? ".store-action"
              : frame.active === 1
                ? ".puzzle"
                : ".pin"
            : ".prompt-input",
      );
      if (!target || !width) return () => {};
      const stage = screen.getBoundingClientRect(),
        box = target.getBoundingClientRect();
      const x = box.x - stage.x,
        y = box.y - stage.y,
        w = box.width,
        h = box.height;
      action = {
        size: [width, height],
        points:
          scene.kind === "server"
            ? []
            : [
                [0, width * 0.2, height * 0.82],
                [0.35, x + w * 0.6, y + h * 0.5],
              ],
        clicks: scene.kind === "server" ? [] : [[0.47, x + w * 0.6, y + h * 0.5]],
        mark: [x, y, w, h],
      };
    }
    const [width, height] = action.size,
      view = action.view ?? [0, 0, width, height],
      unit = view[2] / 600;
    const layer = svgNode(
      "svg",
      { class: "motion-layer", viewBox: view.join(" "), "aria-hidden": "true" },
      screen,
    );
    const type = action.type;
    let spans = [],
      caret;
    if (type) {
      svgNode(
        "rect",
        {
          x: type.box[0],
          y: type.box[1],
          width: type.box[2],
          height: type.box[3],
          fill: "#fff",
        },
        layer,
      );
      const text = svgNode(
        "text",
        {
          class: "typed-text",
          x: type.x,
          y: type.y,
          "font-size": type.font,
          "font-family": "Arial, sans-serif",
          fill: "#252d33",
        },
        layer,
      );
      spans = type.lines.map((line, i) =>
        svgNode("tspan", { x: type.x, y: type.y + i * type.line }, text),
      );
      caret = svgNode(
        "path",
        { class: "typing-caret", stroke: "#17324d", "stroke-width": 2 * unit },
        layer,
      );
    }
    let pencil;
    if (action.mark) {
      const [x, y, w, h] = action.mark;
      pencil = svgNode(
        "path",
        {
          class: "pencil-stroke",
          d: `M${x - 3} ${y + h + 5} Q${x + w * 0.45} ${y + h + 12} ${x + w + 4} ${y + h + 2} M${x + w + 8} ${y + h - 2} Q${x + w + 13} ${y + h * 0.45} ${x + w + 3} ${y - 4}`,
          pathLength: 1,
          "stroke-dasharray": 1,
          "stroke-dashoffset": 1,
          "stroke-width": 3 * unit,
        },
        layer,
      );
    }
    const ring = svgNode(
      "circle",
      { class: "click-ring", r: 0, opacity: 0, "stroke-width": 3 * unit },
      layer,
    );
    const cursor = svgNode("g", { class: "action-cursor" }, layer);
    svgNode(
      "path",
      {
        d: "M0 0 1 29 8 22 15 37 21 34 14 20 26 19Z",
        fill: "#fff",
        stroke: "#17324d",
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
      },
      cursor,
    );
    const mouse = svgNode("g", { class: "mouse-click", opacity: 0 }, layer);
    svgNode(
      "rect",
      {
        x: 0,
        y: 0,
        width: 27,
        height: 39,
        rx: 12,
        fill: "#fff",
        stroke: "#17324d",
        "stroke-width": 2,
      },
      mouse,
    );
    svgNode("path", { d: "M14 2Q25 2 25 14V18H14Z", fill: "#e54d34" }, mouse);
    svgNode(
      "path",
      { d: "M13.5 1V19M1 19H26", stroke: "#17324d", "stroke-width": 1.5, fill: "none" },
      mouse,
    );
    const points = action.points ?? [];
    cursor.setAttribute("visibility", points.length ? "visible" : "hidden");
    let previousCount = -1;
    return (progress) => {
      const p = clamp(progress);
      if (points.length) {
        let start = points[0],
          end = start;
        for (const point of points) {
          if (point[0] <= p) start = point;
          else {
            end = point;
            break;
          }
          end = start;
        }
        const portion =
          start === end
            ? 1
            : 1 - Math.pow(1 - clamp((p - start[0]) / (end[0] - start[0])), 3);
        const x = start[1] + (end[1] - start[1]) * portion,
          y = start[2] + (end[2] - start[2]) * portion;
        cursor.setAttribute("transform", `translate(${x} ${y}) scale(${unit})`);
      }
      ring.setAttribute("opacity", 0);
      mouse.setAttribute("opacity", 0);
      for (const [at, x, y, button] of action.clicks ?? []) {
        const t = (p - at) / 0.14;
        if (t >= 0 && t <= 1) {
          ring.setAttribute("cx", x);
          ring.setAttribute("cy", y);
          ring.setAttribute("r", (9 + 28 * t) * unit);
          ring.setAttribute("opacity", 1 - t);
        }
        if (button === "right" && p > at - 0.1 && p < at + 0.25) {
          mouse.setAttribute(
            "transform",
            `translate(${x + 45 * unit} ${y - 40 * unit}) scale(${unit})`,
          );
          mouse.setAttribute("opacity", 1);
        }
      }
      pencil?.setAttribute("stroke-dashoffset", 1 - clamp((p - 0.5) / 0.28));
      if (type) {
        const length = type.lines.reduce((sum, line) => sum + line.length, 0);
        const count = Math.round(length * clamp((p - type.from) / (type.to - type.from)));
        if (count !== previousCount) {
          let remaining = count,
            last = 0;
          spans.forEach((span, i) => {
            const line = type.lines[i].slice(0, Math.max(0, remaining));
            span.textContent = line;
            remaining -= type.lines[i].length;
            if (line) last = i;
          });
          const x = type.x + spans[last].getComputedTextLength() + 2,
            y = type.y + last * type.line;
          caret.setAttribute("d", `M${x} ${y - type.font * 0.8}V${y + type.font * 0.2}`);
          previousCount = count;
        }
        caret.setAttribute("opacity", p >= type.from && p < type.to + 0.05 ? 1 : 0);
      }
      const prompt = screen.querySelector(".typed-prompt");
      if (prompt)
        prompt.textContent = "Read the feedback. Make the button darker.".slice(
          0,
          Math.round(42 * clamp((p - 0.22) / 0.55)),
        );
    };
  }
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
      this.paused = allPaused || (this.motion.matches && motionChoice !== "playing");
      players.add(this);
      this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${base}demo.css?v=20260928-4"><figure><div class="screen"><div class="frame"></div><button class="screen-hit" type="button"></button><button class="zoom" type="button" aria-label="Enlarge screenshot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></svg></button></div><div class="foot"><p class="caption"></p><div class="controls"></div></div></figure><dialog aria-label="Full-size screenshot"><button type="button">Close</button><img alt=""></dialog>`;
      const q = (s) => this.shadowRoot.querySelector(s),
        screen = q(".screen"),
        frameBox = q(".frame"),
        caption = q(".caption"),
        controls = q(".controls"),
        dialog = q("dialog"),
        hit = q(".screen-hit"),
        zoom = q(".zoom");
      let elapsed = this.paused ? duration : 0,
        visible = false,
        raf = 0,
        last = 0,
        paint = () => {},
        mounted = false;
      const setPaused = (value) => {
        this.paused = value;
        if (!value && elapsed >= duration) elapsed = 0;
        renderControls();
        schedule();
      };
      this.setPlaybackPaused = setPaused;
      const toggle = () => setPaused(!this.paused);
      const steps = scene.frames.map((frame, index) => {
        const b = document.createElement("button");
        b.className = "step";
        b.type = "button";
        b.textContent = String(index + 1);
        b.setAttribute("aria-label", frame.caption);
        b.onclick = () => {
          this.index = index;
          elapsed = duration;
          this.paused = true;
          render();
          schedule();
        };
        controls.append(b);
        return b;
      });
      const play = document.createElement("button");
      play.type = "button";
      play.className = "play";
      play.onclick = toggle;
      controls.append(play);
      hit.onclick = toggle;
      const renderControls = () => {
        const action = this.paused ? "Play" : "Pause";
        play.textContent = action;
        play.setAttribute(
          "aria-label",
          `${action} ${this.getAttribute("step")} walkthrough`,
        );
        hit.setAttribute("aria-label", `${action} animation`);
        steps.forEach((b, i) => b.setAttribute("aria-pressed", String(i === this.index)));
        updateMotionControls();
      };
      const pin =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 3 8 0-1 7 4 4H5l4-4-1-7m4 11v7"/></svg>';
      const puzzle =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h3a3 3 0 1 1 6 0h3v6a3 3 0 1 0 0 6v4h-6a3 3 0 1 0-6 0H4v-7a3 3 0 1 0 0-6V4h4"/></svg>';
      const refreshMotion = () => {
        screen.querySelector(".motion-layer")?.remove();
        paint = actionLayer(screen, scene.frames[this.index], scene);
        paint(elapsed / duration);
      };
      const render = () => {
        const f = scene.frames[this.index];
        caption.textContent = f.caption;
        frameBox.replaceChildren();
        zoom.hidden = !f.image;
        screen.dataset.kind = f.image ? "capture" : "diagram";
        if (f.image) {
          const wrap = document.createElement("div");
          wrap.className = "image";
          const action = actions[f.image],
            view = action.view ?? [0, 0, ...action.size];
          const art = svgNode(
            "svg",
            {
              class: "capture-image",
              viewBox: view.join(" "),
              role: "img",
              "aria-label": f.caption,
            },
            wrap,
          );
          svgNode(
            "image",
            {
              href: base + f.image + ".webp?v=20260928-4",
              width: action.size[0],
              height: action.size[1],
            },
            art,
          );
          frameBox.append(wrap);
        } else {
          const box = document.createElement("div");
          box.className = "diagram";
          if (scene.kind === "chrome")
            box.innerHTML = `<div class="browser-bar"><span class="address">Your website</span><span class="icon puzzle">${puzzle}</span>${f.active === 2 ? '<span class="icon pinned-icon"><strong>F.</strong></span>' : ""}</div><div class="chrome-card">${f.active === 0 ? '<strong>Feedbacks</strong><p>Chrome Web Store</p><span class="store-action">Add to Chrome</span>' : `<strong>Extensions</strong><div class="extension-row"><span>Feedbacks</span><span class="icon pin">${pin}</span></div>`}</div>`;
          else if (scene.kind === "server")
            box.innerHTML = `<div class="sequence">${["DevOps · team server", "Owner · projects & people", "Reviewers + developers · connect"].map((t, i) => `<div class="${i === f.active ? "active" : ""}">${t}<small>${["HTTPS + database + private images", "Project context + member access", "One team URL. Your own account."][i]}</small></div>`).join("")}</div>`;
          else
            box.innerHTML =
              '<div class="agent-note"><strong>Your coding agent</strong><div class="prompt-input"><span class="typed-prompt"></span></div><small>Screenshot · page · element · project context</small></div>';
          frameBox.append(box);
        }
        mounted = true;
        refreshMotion();
        renderControls();
      };
      const tick = (now) => {
        if (last) elapsed += Math.min(now - last, 100);
        last = now;
        if (elapsed >= duration) {
          elapsed = 0;
          this.index = (this.index + 1) % scene.frames.length;
          render();
        }
        paint(elapsed / duration);
        raf = requestAnimationFrame(tick);
      };
      const schedule = () => {
        cancelAnimationFrame(raf);
        last = 0;
        if (visible && !this.paused && !document.hidden)
          raf = requestAnimationFrame(tick);
      };
      const observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (visible && !mounted) render();
          schedule();
        },
        { threshold: 0.25 },
      );
      observer.observe(this);
      const resize = new ResizeObserver(() => {
        if (mounted) refreshMotion();
      });
      resize.observe(screen);
      q("link").addEventListener("load", () => {
        if (mounted) refreshMotion();
      });
      const visibility = () => schedule();
      document.addEventListener("visibilitychange", visibility);
      const reduce = () => {
        if (this.motion.matches) {
          elapsed = duration;
          setPaused(true);
          if (mounted) paint(1);
        }
      };
      this.motion.addEventListener("change", reduce);
      zoom.onclick = () => {
        setPaused(true);
        const f = scene.frames[this.index];
        q("dialog img").src = base + f.image + ".webp?v=20260928-4";
        q("dialog img").alt = f.caption;
        dialog.showModal();
      };
      q("dialog button").onclick = () => dialog.close();
      dialog.addEventListener("close", () => zoom.focus());
      caption.textContent = scene.frames[0].caption;
      renderControls();
      this.cleanup = () => {
        players.delete(this);
        this.setPlaybackPaused = undefined;
        updateMotionControls();
        cancelAnimationFrame(raf);
        observer.disconnect();
        resize.disconnect();
        document.removeEventListener("visibilitychange", visibility);
        this.motion.removeEventListener("change", reduce);
      };
    }
  }
  if (!customElements.get("feedbacks-demo"))
    customElements.define("feedbacks-demo", FeedbacksDemo);
})();
