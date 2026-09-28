const scenes = [
  {
    image: "point.png",
    label: "Chrome extension · on your website",
    note: "this button, right here.",
    title: "Right-click. Say what needs changing.",
    copy: "Click the pinned extension. Right-click an element, write your note, then Save point.",
    context: "The screenshot + exact element come along.",
    guide: "Install & pin the extension",
    href: "/docs/guide/chrome-extension",
    alt: "Actual Feedbacks extension: right-click Add to bag on a demo furniture website and write a comment.",
  },
  {
    image: "review.png",
    label: "Chrome extension · Review & send",
    note: "a quick look before it goes.",
    title: "Check the picture. Send the feedback.",
    copy: "Choose Review & send to finalize. Check your notes and images, redact private details, then Send feedback.",
    context: "Nothing is shared until you press Send feedback.",
    guide: "See the capture guide",
    href: "/docs/guide/chrome-extension#your-first-point-click-right-click-save",
    alt: "Actual extension review editor with captured screenshot, annotation tools and Send feedback button.",
  },
  {
    image: "thread.png",
    label: "Feedbacks app · on your team’s server",
    note: "your agent gets the picture.",
    title: "One thread. The whole picture.",
    copy: "Your team sees the request on your server. Connect your agent through MCP and ask it to work through the change.",
    context: "Your developer checks the fix before resolving it.",
    guide: "Connect your AI agent",
    href: "/docs/guide/mcp",
    alt: "Actual Feedbacks server thread showing the submitted button change request and its screenshot.",
  },
];
const buttons = [...document.querySelectorAll("[data-scene]")];
const img = document.querySelector("#story-image");
const stage = document.querySelector(".story-stage");
const play = document.querySelector(".play-story");
const demo = document.querySelector("#story-demo");
const still = document.querySelector(".screen-zoom");
function toggleDemo() {
  const watching = demo.hidden;
  demo.hidden = !watching;
  still.hidden = watching;
  play.querySelector(".play-label").textContent = watching
    ? "Still image"
    : "Watch steps";
  play.setAttribute("aria-label", watching ? "View screenshot" : "Watch walkthrough");
  play.setAttribute("aria-pressed", String(watching));
  play.querySelector(".play-icon").style.display = watching ? "none" : "";
}
function show(index) {
  demo.setAttribute("step", ["capture", "send", "agent"][index]);
  const s = scenes[index];
  img.src = `/media/workflow/${s.image}`;
  img.alt = s.alt;
  const detail = document.querySelector("#story-detail");
  detail.srcset = `/media/workflow/${index === 0 ? "point-detail.png" : s.image}`;
  img.width = index === 0 ? 900 : 1100;
  img.height = index === 0 ? 740 : 760;
  const mark = document.querySelector(".capture-mark");
  mark.setAttribute("viewBox", index === 0 ? "0 0 900 740" : "0 0 1100 760");
  mark
    .querySelector("path")
    .setAttribute(
      "d",
      [
        "M830 290C780 310 670 340 550 422m8-20-8 20 22-4",
        "M890 110Q935 120 995 55m-20 6 20-6-5 20",
        "M980 570C940 680 750 695 390 625m12 18-12-18 22-2",
      ][index],
    );
  stage.dataset.active = index;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
  for (const [id, value] of Object.entries({
    "screen-label": s.label,
    "pencil-note": s.note,
    "scene-title": s.title,
    "scene-copy": s.copy,
    "context-slip": s.context,
  })) {
    document.getElementById(id).textContent = value;
  }
  const guide = document.querySelector("#scene-guide");
  guide.firstChild.textContent = s.guide + " ";
  guide.href = s.href;
  document
    .querySelector(".screen-zoom")
    .setAttribute("aria-label", `Enlarge screenshot: ${s.label}`);
  stage.classList.remove("scene-enter");
  requestAnimationFrame(() => stage.classList.add("scene-enter"));
}
buttons.forEach((b, i) =>
  b.addEventListener("click", () => {
    show(i);
  }),
);
play.addEventListener("click", toggleDemo);
const dialog = document.querySelector("#screen-dialog");
document.querySelector(".screen-zoom").addEventListener("click", () => {
  const enlarged = dialog.querySelector("img");
  enlarged.src = img.src;
  enlarged.alt = img.alt;
  dialog.showModal();
});
dialog.querySelector(".close-screen").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});
