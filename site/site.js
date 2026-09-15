const demo = document.querySelector(".demo");
const steps = {
  capture: {
    state: "Open",
    explanation: "Capture the page and mark the exact point that needs attention.",
    evidence: "Screenshot, page URL and viewport",
  },
  discuss: {
    state: "In progress",
    reply: "Agreed. I’ll adjust the spacing and check the mobile layout too.",
    explanation:
      "Discuss the change beside the original feedback. Everyone starts with the same context.",
    evidence: "The original capture stays with the conversation",
  },
  resolve: {
    state: "Resolved",
    reply:
      "Spacing updated. Checked at desktop and mobile widths. Ready for another look.",
    explanation: "Record the outcome so the next reviewer can see what changed.",
    evidence: "Outcome recorded; original feedback preserved",
  },
};
for (const button of document.querySelectorAll("[data-step]")) {
  button.addEventListener("click", () => {
    const step = button.dataset.step;
    const content = steps[step];
    demo.dataset.stage = step;
    for (const control of document.querySelectorAll("[data-step]"))
      control.setAttribute("aria-pressed", String(control === button));
    document.querySelector("#demo-state").textContent = content.state;
    document.querySelector("#demo-explanation").textContent = content.explanation;
    document.querySelector("#demo-evidence").textContent = content.evidence;
    document.querySelector("#demo-reply").hidden = !content.reply;
    document.querySelector("#demo-reply-text").textContent = content.reply || "";
  });
}
const copyButton = document.querySelector("#copy-command");
if (navigator.clipboard?.writeText) {
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    const status = document.querySelector("#copy-status");
    copyButton.disabled = true;
    try {
      await navigator.clipboard.writeText(
        document.querySelector("#clone-command").textContent,
      );
      status.textContent = "Commands copied.";
    } catch {
      status.textContent = "Copy is unavailable. Select and copy the commands above.";
    } finally {
      copyButton.disabled = false;
    }
  });
}
