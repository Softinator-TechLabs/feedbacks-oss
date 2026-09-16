const demo = document.querySelector(".main-scrap");
const steps = {
  mark: {
    name: "Maya",
    role: "Design reviewer",
    avatar: "M",
    comment: "“Give this button a little more breathing room.”",
    status: "Open",
    explanation: "A screenshot and a pencil mark keep the exact point in view.",
  },
  discuss: {
    name: "Arjun",
    role: "Product reviewer",
    avatar: "A",
    comment: "“Yes. Keep the mobile layout in mind, too.”",
    status: "Discussing",
    explanation: "Your team works through the details in one thread.",
  },
  agent: {
    name: "Coding assistant",
    role: "Connected through MCP",
    avatar: "AI",
    comment: "“I have the screenshot and both comments. I’ll check both sizes.”",
    status: "Context read",
    explanation:
      "Your assistant reads the capture, replies and approved reviewer guidance through MCP.",
  },
};
for (const button of document.querySelectorAll("[data-step]"))
  button.addEventListener("click", () => {
    const step = button.dataset.step,
      value = steps[step];
    demo.dataset.stage = step;
    for (const control of document.querySelectorAll("[data-step]"))
      control.setAttribute("aria-pressed", String(control === button));
    document.querySelector("#example-avatar").textContent = value.avatar;
    const author = document.querySelector("#example-author"),
      role = document.createElement("span");
    role.textContent = value.role;
    author.replaceChildren(document.createTextNode(value.name + " "), role);
    document.querySelector("#example-comment").textContent = value.comment;
    document.querySelector("#example-status").textContent = value.status;
    document.querySelector("#demo-explanation").textContent = value.explanation;
    demo.classList.remove("replay");
    if (step === "mark")
      requestAnimationFrame(() => {
        demo.classList.add("replay");
      });
  });
