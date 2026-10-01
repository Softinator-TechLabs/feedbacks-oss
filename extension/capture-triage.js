// Both capture editors use a bounded, searchable project-member picker.
export function createCaptureTriage(root, { load, onChange = () => {} }) {
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  root.classList.add("capture-triage");
  const token = `triage-${crypto.randomUUID()}`;
  const priority = make("select"),
    priorityLabel = make("label", "Priority");
  priority.id = `${token}-priority`;
  priorityLabel.htmlFor = priority.id;
  for (const [value, label] of [
    ["normal", "Normal"],
    ["high", "High"],
    ["low", "Low"],
  ])
    priority.add(new Option(label, value));
  const field = make("div"),
    label = make("label", "Assign to"),
    trigger = make("button");
  field.className = "capture-assignee";
  trigger.id = `${token}-assignee`;
  trigger.type = "button";
  trigger.className = "capture-assignee-trigger secondary";
  trigger.setAttribute("aria-label", "Assign to");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  label.htmlFor = trigger.id;
  const valueLabel = make("span", "Unassigned"),
    chevron = make("span", "⌄");
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(valueLabel, chevron);
  const popup = make("div"),
    search = make("div"),
    input = make("input"),
    list = make("div"),
    notice = make("p"),
    count = make("p"),
    navigation = make("div");
  popup.id = `${token}-popup`;
  popup.className = "capture-assignee-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "Choose assignee");
  popup.hidden = true;
  trigger.setAttribute("aria-controls", popup.id);
  search.className = "capture-assignee-search";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS(icon.namespaceURI, "circle"),
    line = document.createElementNS(icon.namespaceURI, "path");
  circle.setAttribute("cx", "10");
  circle.setAttribute("cy", "10");
  circle.setAttribute("r", "6");
  line.setAttribute("d", "m15 15 5 5");
  icon.append(circle, line);
  input.type = "search";
  input.placeholder = "Search members";
  input.autocomplete = "off";
  input.maxLength = 120;
  input.setAttribute("aria-label", "Search project members");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  list.id = `${token}-options`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Project assignees");
  input.setAttribute("aria-controls", list.id);
  search.append(icon, input);
  notice.setAttribute("role", "status");
  notice.className = "hint";
  count.setAttribute("role", "status");
  count.className = "capture-assignee-count";
  const previous = make("button", "Previous"),
    more = make("button", "More");
  navigation.className = "capture-assignee-navigation";
  for (const button of [previous, more]) button.type = "button";
  navigation.append(previous, more);
  popup.append(search, list, count, navigation);
  field.append(label, trigger, popup);
  const priorityField = make("div");
  priorityField.append(priorityLabel, priority);
  root.append(priorityField, field, notice);
  let selected = null,
    query = "",
    offset = 0,
    nextOffset = null,
    items = [],
    active = -1;
  let generation = 0,
    timer,
    disabled = false,
    canAssign = false,
    canPlan = false;
  function close(restoreFocus = false) {
    popup.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    clearTimeout(timer);
    if (restoreFocus) trigger.focus();
  }
  function availability() {
    priority.disabled = disabled || !canPlan;
    trigger.disabled = input.disabled = disabled || !canAssign;
    for (const button of [previous, more]) button.disabled = disabled;
  }
  function highlight() {
    [...list.children].forEach((option, index) =>
      option.setAttribute("aria-selected", String(index === active)),
    );
    if (active >= 0)
      input.setAttribute("aria-activedescendant", list.children[active].id);
    else input.removeAttribute("aria-activedescendant");
  }
  function choose(item) {
    if (disabled || !canAssign) return;
    selected = item?.id ? item : null;
    valueLabel.textContent = selected?.name || "Unassigned";
    query = "";
    offset = 0;
    close(true);
    onChange();
  }
  async function refresh() {
    const request = ++generation;
    list.replaceChildren();
    items = [];
    active = -1;
    highlight();
    count.textContent = "Loading…";
    try {
      const result = await load({ search: query, offset });
      if (request !== generation) return;
      canAssign = !!result.canAssign;
      canPlan = !!result.canPlan;
      availability();
      const members = (result.items || []).slice(0, 10);
      items = !query.trim() ? [{ id: null, name: "Unassigned" }, ...members] : members;
      nextOffset = result.nextOffset ?? null;
      previous.hidden = offset === 0;
      more.hidden = nextOffset === null;
      navigation.hidden = previous.hidden && more.hidden;
      for (const [index, item] of items.entries()) {
        const option = make("div", item.name);
        option.id = `${token}-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        if (item.id) option.dataset.member = item.id;
        option.onmousedown = (event) => event.preventDefault();
        option.onclick = () => choose(item);
        list.append(option);
      }
      notice.textContent = result.unsupported
        ? "Update your Feedbacks server to enable capture priority and assignment."
        : !canAssign || !canPlan
          ? "Reconnect Feedbacks to enable capture priority and assignment."
          : "";
      count.textContent = members.length
        ? `${offset + 1}–${offset + members.length} of ${result.total} members`
        : "No matching project members.";
    } catch {
      if (request !== generation) return;
      canAssign = canPlan = false;
      availability();
      notice.textContent =
        "Could not load project members. Reopen capture review to retry.";
      count.textContent = "Members unavailable.";
    }
  }
  function open() {
    if (disabled || !canAssign) return;
    query = "";
    offset = 0;
    input.value = "";
    popup.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-expanded", "true");
    input.focus();
    void refresh();
  }
  priority.onchange = onChange;
  trigger.onclick = () => (popup.hidden ? open() : close(true));
  trigger.onkeydown = (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      open();
    }
  };
  input.oninput = () => {
    query = input.value;
    offset = 0;
    ++generation;
    clearTimeout(timer);
    list.replaceChildren();
    items = [];
    active = -1;
    input.removeAttribute("aria-activedescendant");
    timer = setTimeout(() => void refresh(), 180);
  };
  input.onkeydown = (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!items.length) return;
      active = Math.max(
        0,
        Math.min(items.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)),
      );
      highlight();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && items[active]) choose(items[active]);
    }
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden) {
      event.preventDefault();
      close(true);
    }
  });
  root.addEventListener("focusout", (event) => {
    if (!field.contains(event.relatedTarget)) close();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!field.contains(event.target)) close();
  });
  previous.onclick = () => {
    offset = Math.max(0, offset - 10);
    input.focus();
    void refresh();
  };
  more.onclick = () => {
    if (nextOffset !== null) {
      offset = nextOffset;
      input.focus();
      void refresh();
    }
  };
  availability();
  return {
    value: () =>
      priority.value === "normal" && !selected
        ? undefined
        : { priority: priority.value, ...(selected ? { assigneeId: selected.id } : {}) },
    label: () => selected?.name,
    reset(value, name) {
      ++generation;
      clearTimeout(timer);
      selected = value?.assigneeId
        ? { id: value.assigneeId, name: name || `Member …${value.assigneeId.slice(-6)}` }
        : null;
      valueLabel.textContent = selected?.name || "Unassigned";
      priority.value = value?.priority || "normal";
      query = "";
      offset = 0;
      close();
      canAssign = canPlan = false;
      availability();
      void refresh();
    },
    setDisabled(value) {
      disabled = !!value;
      availability();
      if (disabled) close();
    },
  };
}
