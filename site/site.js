const steps = {
  capture: [
    "Right-click the element. Explain the change.",
    "Open the pinned Feedbacks extension on the website. Hover the button, right-click it, write the note and choose Save point.",
    "The point’s original screenshot and viewport",
    "Saved in this browser. Not sent yet.",
    "Add more points, then choose Review & send.",
  ],
  send: [
    "Check the evidence before you share it.",
    "Choose Review & send to finalize your saved points. Check the images and notes, redact private details, then choose Send feedback.",
    "Reviewed screenshots and notes attached to the same thread",
    "Shared only after Send feedback.",
    "Open the thread on your team’s Feedbacks server.",
  ],
  agent: [
    "Ask your agent to read the feedback.",
    "The developer connects their own agent through MCP, reads the request with project guidance and asks it to make the agreed change in the codebase.",
    "Page, element, screenshots, comments and authorized project context",
    "Developer verifies the change before resolving.",
    "Record the actual checks and commit or PR in the thread.",
  ],
};
for (const button of document.querySelectorAll("[data-step]")) {
  button.addEventListener("click", () => {
    const value = steps[button.dataset.step];
    for (const control of document.querySelectorAll("[data-step]"))
      control.setAttribute("aria-pressed", String(control === button));
    [
      "demo-title",
      "demo-description",
      "demo-evidence",
      "demo-state",
      "demo-next",
    ].forEach((id, index) => {
      document.getElementById(id).textContent = value[index];
    });
  });
}
