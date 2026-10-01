// Both capture editors use the same bounded project-member picker.
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
    input = make("input");
  field.className = "capture-assignee";
  input.id = `${token}-assignee`;
  label.htmlFor = input.id;
  input.type = "text";
  input.placeholder = "Unassigned";
  input.autocomplete = "off";
  input.maxLength = 120;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  const popup = make("div"),
    list = make("div"),
    notice = make("p"),
    navigation = make("div");
  popup.className = "capture-assignee-popup";
  popup.hidden = true;
  list.id = `${token}-options`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Project assignees");
  input.setAttribute("aria-controls", list.id);
  notice.setAttribute("role", "status");
  notice.className = "hint";
  const previous = make("button", "Previous"),
    more = make("button", "More"),
    clear = make("button", "Unassigned");
  navigation.className = "capture-assignee-navigation";
  for (const button of [previous, more, clear]) button.type = "button";
  navigation.append(previous, more, clear);
  popup.append(list, navigation);
  field.append(label, input, popup);
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
  function close() {
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    input.value = selected?.name || "";
  }
  function availability() {
    priority.disabled = disabled || !canPlan;
    input.disabled = disabled || !canAssign;
    for (const button of [previous, more, clear]) button.disabled = disabled;
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
    selected = item;
    query = "";
    offset = 0;
    input.focus();
    close();
    onChange();
  }
  async function refresh() {
    const request = ++generation;
    list.replaceChildren();
    items = [];
    active = -1;
    highlight();
    notice.textContent = "Loading project members…";
    try {
      const result = await load({ search: query, offset });
      if (request !== generation) return;
      canAssign = !!result.canAssign;
      canPlan = !!result.canPlan;
      availability();
      items = (result.items || []).slice(0, 10);
      nextOffset = result.nextOffset ?? null;
      previous.hidden = offset === 0;
      more.hidden = nextOffset === null;
      for (const [index, item] of items.entries()) {
        const option = make("div", item.name);
        option.id = `${token}-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.onmousedown = (event) => event.preventDefault();
        option.onclick = () => choose(item);
        list.append(option);
      }
      notice.textContent = result.unsupported
        ? "Update your Feedbacks server to enable capture priority and assignment."
        : !canAssign || !canPlan
          ? "Reconnect Feedbacks to enable capture priority and assignment."
          : items.length
            ? `${offset + 1}–${offset + items.length} of ${result.total} members`
            : "No matching project members.";
    } catch {
      if (request !== generation) return;
      canAssign = canPlan = false;
      availability();
      notice.textContent =
        "Could not load project members. Reopen capture review to retry.";
    }
  }
  priority.onchange = onChange;
  input.onfocus = () => {
    if (disabled || !canAssign) return;
    popup.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.value = selected?.name || query;
    input.select();
    void refresh();
  };
  input.onclick = () => {
    if (popup.hidden) input.onfocus();
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
      popup.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (!items.length) return;
      active = Math.max(
        0,
        Math.min(items.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)),
      );
      highlight();
    } else if (event.key === "Enter" && active >= 0 && list.children[active]) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  root.addEventListener("focusout", (event) => {
    if (!field.contains(event.relatedTarget)) close();
  });
  previous.onclick = () => {
    offset = Math.max(0, offset - 10);
    void refresh();
  };
  more.onclick = () => {
    if (nextOffset !== null) {
      offset = nextOffset;
      void refresh();
    }
  };
  clear.onclick = () => choose(null);
  availability();
  return {
    value: () =>
      priority.value === "normal" && !selected
        ? undefined
        : {
            priority: priority.value,
            ...(selected ? { assigneeId: selected.id } : {}),
          },
    label: () => selected?.name,
    reset(value, name) {
      ++generation;
      clearTimeout(timer);
      selected = value?.assigneeId
        ? { id: value.assigneeId, name: name || `Member …${value.assigneeId.slice(-6)}` }
        : null;
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
