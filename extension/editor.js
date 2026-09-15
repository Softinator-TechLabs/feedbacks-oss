const $ = (id) => document.getElementById(id);
const send = async (message) => {
  const r = await chrome.runtime.sendMessage(message);
  if (!r.ok) throw Object.assign(Error(r.error), { code: r.code });
  return r.data;
};
const canvas = $("canvas"),
  ctx = canvas.getContext("2d");
let draft,
  base,
  shapes = [],
  tool = "pencil",
  current,
  saveTimer,
  saving = Promise.resolve(),
  dirty = false,
  redacting = false,
  baseLoad = 0,
  loadingBase = false;
let originalTabId;
function completed(url) {
  clearTimeout(saveTimer);
  dirty = false;
  baseLoad++;
  base = null;
  shapes = [];
  current = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  draft = null;
  $("body").value = "";
  $("editor-workspace").hidden = true;
  $("discard").hidden = true;
  $("completion").hidden = false;
  $("completion-title").textContent = url ? "Feedback sent" : "No pending capture";
  $("completion-copy").textContent = url
    ? "Your team can now see it. The local draft has been cleared."
    : "Return to a website and right-click the point you want to comment on.";
  $("thread").hidden = !url;
  if (url) $("thread").href = url;
  $("return-page").hidden = !Number.isInteger(originalTabId);
  $("completion-title").focus();
}
$("return-page").onclick = async () => {
  try {
    const tab = await chrome.tabs.get(originalTabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    window.close();
  } catch {
    $("completion-error").textContent =
      "The original tab is closed. Open the website to leave another comment.";
  }
};
function status(message, kind = "info") {
  $("status").textContent = message;
  $("status").dataset.kind = kind;
  if (!$("completion").hidden) $("completion-error").textContent = message;
}
function drawShape(s) {
  ctx.strokeStyle = "#b92332";
  ctx.fillStyle = s.tool === "redact" ? "#202c37" : "#b92332";
  ctx.lineWidth = Math.max(3, canvas.width / 450);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const a = s.points[0],
    b = s.points.at(-1);
  if (s.tool === "point") {
    const radius = Math.max(12, canvas.width / 120);
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#17324d";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${radius * 1.35}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("1", a.x, a.y);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  } else if (s.tool === "text") {
    ctx.font = `600 ${Math.max(22, canvas.width / 55)}px system-ui`;
    ctx.fillText(s.text, a.x, a.y);
  } else if (s.tool === "redact")
    ctx.fillRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.max(2, Math.abs(b.x - a.x)),
      Math.max(2, Math.abs(b.y - a.y)),
    );
  else if (s.tool === "rectangle") ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  else {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (s.tool === "arrow") {
      const angle = Math.atan2(b.y - a.y, b.x - a.x),
        len = Math.max(16, canvas.width / 65);
      ctx.beginPath();
      ctx.moveTo(b.x - len * Math.cos(angle - 0.5), b.y - len * Math.sin(angle - 0.5));
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x - len * Math.cos(angle + 0.5), b.y - len * Math.sin(angle + 0.5));
      ctx.stroke();
    }
  }
}
function render() {
  if (!base) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);
  for (const s of shapes) drawShape(s);
  if (current) drawShape(current);
}
function payload() {
  return {
    type: "saveDraft",
    id: draft.id,
    imageRevision: draft.imageRevision || 0,
    body: $("body").value,
    projectId: $("project").value,
    noImage: $("no-image").checked,
    toolState: shapes,
  };
}
function persist() {
  clearTimeout(saveTimer);
  if (!draft || draft.frozen) return saving;
  const message = payload();
  saving = saving
    .catch(() => {})
    .then(() => send(message))
    .then(() => {
      dirty = false;
    })
    .catch((e) => {
      dirty = true;
      status(`Draft could not be saved: ${e.message}`, "error");
      throw e;
    });
  return saving;
}
function schedule() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist().catch(() => {}), 250);
}
function redactionRectangle(shape) {
  const a = shape.points[0],
    b = shape.points.at(-1);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(2, Math.abs(b.x - a.x)),
    height: Math.max(2, Math.abs(b.y - a.y)),
  };
}
async function loadBase(fresh) {
  if (draft && fresh && (fresh.imageRevision || 0) < (draft.imageRevision || 0)) return;
  const request = ++baseLoad;
  loadingBase = true;
  lock(true);
  $("send").disabled = true;
  base = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (draft) draft.image = draft.approvedImage = null;
  draft = fresh;
  if (!fresh) {
    shapes = [];
    lock(true);
    $("send").disabled = true;
    loadingBase = false;
    completed();
    return;
  }
  const pixels = fresh.approvedImage || fresh.image;
  if (pixels) {
    const decoded = new Image();
    decoded.src = pixels;
    await decoded.decode();
    if (request !== baseLoad) return;
    base = decoded;
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
  }
  shapes = fresh.toolState || [];
  $("no-image").checked = !!fresh.noImage;
  $("retry-capture").hidden = !!pixels || !!fresh.frozen;
  canvas.hidden = !pixels;
  current = null;
  render();
  loadingBase = false;
  lock(redacting || !!draft.frozen);
  $("send").disabled = redacting;
}
async function permanentRedaction(rectangles, migrate = false) {
  redacting = true;
  dirty = true;
  clearTimeout(saveTimer);
  lock(true);
  $("send").disabled = $("discard").disabled = true;
  status("Permanently saving redaction…");
  try {
    if (!migrate) await persist();
    const fresh = await send({ type: "redactDraft", id: draft.id, rectangles });
    await loadBase(fresh);
    dirty = false;
    status(
      "Redaction permanently saved. Undo and Reset affect only ordinary annotations.",
    );
  } catch (error) {
    const fresh = await send({ type: "draft" }).catch(() => null);
    await loadBase(fresh);
    status(`Redaction was not saved: ${error.message}`, "error");
    throw error;
  } finally {
    redacting = false;
    lock(!draft || !!draft.frozen || loadingBase);
    $("send").disabled = !draft || loadingBase;
    $("discard").disabled = false;
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.draft || !draft) return;
  const fresh = changes.draft.newValue;
  if (!fresh || fresh.id !== draft.id) {
    clearTimeout(saveTimer);
    loadBase(null).catch(() => {});
  } else if ((fresh.imageRevision || 0) > (draft.imageRevision || 0)) {
    clearTimeout(saveTimer);
    lock(true);
    loadBase(fresh)
      .then(() => {
        lock(redacting || loadingBase || !!draft?.frozen);
        if (!redacting)
          status(
            "Permanent redactions were updated. Review the current image before sending.",
          );
      })
      .catch((error) =>
        status(`Draft image could not be loaded: ${error.message}`, "error"),
      );
  }
});
function point(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.x) * canvas.width) / r.width,
    y: ((e.clientY - r.y) * canvas.height) / r.height,
  };
}
canvas.onpointerdown = (e) => {
  if (!draft || draft.frozen || redacting || loadingBase || $("no-image").checked) return;
  if (tool === "text" && !$("annotation").value.trim()) {
    status("Write the text label first.");
    $("annotation").focus();
    return;
  }
  current = {
    tool,
    points: [point(e)],
    ...(tool === "text" ? { text: $("annotation").value.trim() } : {}),
  };
  canvas.setPointerCapture(e.pointerId);
  render();
};
canvas.onpointermove = (e) => {
  if (!current || redacting || loadingBase) return;
  if (tool === "pencil") {
    if (current.points.length < 10000) current.points.push(point(e));
  } else current.points[1] = point(e);
  render();
};
canvas.onpointerup = () => {
  if (!current || redacting || loadingBase) return;
  if (current.tool === "redact") {
    const rectangle = redactionRectangle(current);
    current = null;
    permanentRedaction([rectangle]).catch(() => {});
    return;
  }
  shapes.push(current);
  current = null;
  render();
  schedule();
};
canvas.onpointercancel = () => {
  current = null;
  render();
};
for (const b of document.querySelectorAll("[data-tool]"))
  b.onclick = () => {
    tool = b.dataset.tool;
    document.querySelector(".text-label").hidden = tool !== "text";
    if (tool === "text") $("annotation").focus();
    for (const sibling of document.querySelectorAll("[data-tool]"))
      sibling.setAttribute("aria-pressed", String(sibling === b));
  };
$("undo").onclick = () => {
  if (!draft?.frozen && !redacting) {
    shapes.pop();
    render();
    schedule();
  }
};
$("reset").onclick = () => {
  if (!draft?.frozen && !redacting) {
    shapes = [];
    render();
    schedule();
  }
};
for (const id of ["body", "project", "no-image"]) $(id).oninput = schedule;
$("no-image").addEventListener("change", () => {
  canvas.style.opacity = $("no-image").checked ? ".35" : "1";
});
$("discard").onclick = async () => {
  if (!confirm("Discard this local draft and its screenshot?")) return;
  clearTimeout(saveTimer);
  await saving.catch(() => {});
  await send({ type: "discard" });
  window.close();
};
function lock(value) {
  for (const el of document.querySelectorAll(
    "input,select,textarea,[data-tool],#undo,#reset",
  ))
    el.disabled = value;
  $("no-image").disabled = value || !base;
  for (const el of document.querySelectorAll("[data-tool],#undo,#reset,#annotation"))
    el.disabled = value || !base;
}
$("retry-capture").onclick = async () => {
  if (!draft || draft.frozen) return;
  $("retry-capture").disabled = true;
  try {
    await persist();
    lock(true);
    $("send").disabled = true;
    status("Retrying capture on the original review tab…");
    const result = await send({ type: "retryCapture", id: draft.id });
    await loadBase(await send({ type: "draft" }));
    status(
      result.captured
        ? "Capture ready. Add your comment and send."
        : `${result.error} Continue without an image or retry capture.`,
      result.captured ? "info" : "error",
    );
  } catch (error) {
    status(error.message, "error");
  } finally {
    lock(!draft || !!draft.frozen || loadingBase);
    $("send").disabled = !draft || loadingBase;
    $("retry-capture").disabled = false;
  }
};
$("send").onclick = async () => {
  if (!draft || redacting || loadingBase) return;
  $("send").disabled = true;
  $("discard").disabled = true;
  status("Sending approved feedback…");
  try {
    const approvalRevision = draft.imageRevision || 0;
    if (!draft.frozen) {
      await persist();
      if (
        !draft ||
        loadingBase ||
        redacting ||
        (draft.imageRevision || 0) !== approvalRevision
      )
        throw Error(
          "Redactions changed while saving. Review the current image before sending.",
        );
      render();
    }
    const result = await send({
      type: "submit",
      id: draft.id,
      imageRevision: approvalRevision,
      image: draft.frozen ? undefined : canvas.toDataURL("image/png"),
    });
    completed(result.url);
  } catch (e) {
    const fresh = await send({ type: "draft" }).catch(() => null);
    if (fresh) await loadBase(fresh);
    lock(!draft || loadingBase || !!draft?.frozen);
    status(
      fresh
        ? `${e.message} Your draft is kept here. Review it before retrying Send.`
        : `${e.message} No local draft remains. Check Feedbacks for any completed submission.`,
      "error",
    );
    $("send").disabled = !draft || loadingBase;
    $("send").textContent = "Retry Send";
    $("discard").disabled = false;
  }
};
addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function init() {
  draft = await send({ type: "draft" });
  if (!draft) {
    completed();
    return;
  }
  originalTabId = draft.sourceTabId;
  const { items } = await send({ type: "draftProjects" }),
    origin = new URL(draft.context.url).origin;
  for (const p of items)
    if (p.permissions.canWrite && (p.origins.includes(origin) || p.captureMode === "any"))
      $("project").add(new Option(p.name, p.id));
  $("project").value = draft.projectId;
  $("body").value = draft.body;
  $("no-image").checked = draft.noImage;
  const legacy = (draft.toolState || []).filter((shape) => shape.tool === "redact");
  if (legacy.length && !draft.frozen)
    await permanentRedaction(legacy.map(redactionRectangle), true);
  else await loadBase({ ...draft });
  $("context").textContent =
    `${draft.context.url}\n${draft.context.viewport.width} × ${draft.context.viewport.height} CSS pixels`;
  $("capture-origin").textContent = new URL(draft.context.url).hostname;
  $("capture-size").textContent =
    `${draft.context.viewport.width} × ${draft.context.viewport.height} · Capture details`;
  lock(!!draft.frozen);
  $("send").disabled = false;
  if (draft.frozen) {
    $("send").textContent = "Retry Send";
    status(
      "Pending submission. Retry uses the same approved content and idempotency keys.",
    );
  } else if (draft.captureError) {
    status(
      `${draft.captureError} Your target context is saved. Continue without an image, or retry capture on the original tab.`,
      "error",
    );
  } else if (draft.pointCapture) {
    status("Point marked. Add your comment, review the screenshot, then Send.");
    $("body").focus({ preventScroll: true });
  }
}
lock(true);
$("send").disabled = true;
init().catch((e) => {
  status(e.message, "error");
  $("send").disabled = true;
});
