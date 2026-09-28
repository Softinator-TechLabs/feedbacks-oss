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
const stage = document.querySelector(".story-stage");
const demo = document.querySelector("#story-demo");
function show(index) {
  demo.setAttribute("step", ["capture", "send", "agent"][index]);
  const s = scenes[index];
  stage.dataset.active = index;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
  for (const [id, value] of Object.entries({
    "pencil-note": s.note,
    "scene-title": s.title,
  })) {
    document.getElementById(id).textContent = value;
  }
  const guide = document.querySelector("#scene-guide");
  guide.firstChild.textContent = s.guide + " ";
  guide.href = s.href;
  stage.classList.remove("scene-enter");
  requestAnimationFrame(() => stage.classList.add("scene-enter"));
}
buttons.forEach((b, i) =>
  b.addEventListener("click", () => {
    show(i);
  }),
);
