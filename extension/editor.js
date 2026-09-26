import { getPage } from "./page-store.js";
import { combinedImageSize } from "./combined-image.js";

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
  pageIndex = 0,
  tool = "pencil",
  current,
  saveTimer,
  saving = Promise.resolve(),
  dirty = false,
  redacting = false,
  sendingApproval = false,
  baseLoad = 0,
  loadingBase = false;
let originalTabId;
let thumbnailObserver;
let previewUrl;
let previewBuild = 0;
const thumbnailCache = new Map();
function hideFullPagePreview() {
  previewBuild++;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("preview-slot").replaceChildren();
  $("preview-slot").hidden = true;
  $("preview-guide").hidden = true;
  $("tools").hidden = false;
  $("full-page-toggle").textContent = "Full page preview";
  $("full-page-toggle").setAttribute("aria-pressed", "false");
  $("remove-current").hidden = !!draft?.frozen;
  $("canvas").hidden = !base;
  $("series-guide").hidden = (draft?.capturePages?.length || 0) < 2;
}
function uploadProgress(completed, total) {
  if (!Number.isInteger(total) || total < 1) return;
  const count = Math.min(total, Math.max(0, completed));
  const percent = Math.round((count / total) * 100);
  $("upload-progress").hidden = false;
  $("upload-meter").value = percent;
  $("upload-label").textContent = `${count} of ${total} images uploaded · ${percent}%`;
}
function completed(url) {
  hideFullPagePreview();
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
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "submitProgress" && message.id === draft?.id) {
    status(message.message);
    if (Number.isInteger(message.completed))
      uploadProgress(message.completed, message.total);
  }
});
function drawShape(s, surface = ctx, width = canvas.width) {
  const ctx = surface;
  ctx.strokeStyle = "#b92332";
  ctx.fillStyle = s.tool === "redact" ? "#202c37" : "#b92332";
  ctx.lineWidth = Math.max(3, width / 450);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const a = s.points[0],
    b = s.points.at(-1);
  if (s.tool === "point") {
    const radius = Math.max(12, width / 120);
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
    ctx.fillText(String(s.number || 1), a.x, a.y);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  } else if (s.tool === "text") {
    ctx.font = `600 ${Math.max(22, width / 55)}px system-ui`;
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
        len = Math.max(16, width / 65);
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
async function showFullPagePreview() {
  if (!draft?.capturePages || draft.capturePages.length < 2 || loadingBase) return;
  const request = ++previewBuild;
  const toggle = $("full-page-toggle");
  toggle.disabled = true;
  $("canvas-scroll").setAttribute("aria-busy", "true");
  status("Preparing the full-page preview…");
  try {
    if (!draft.frozen) await persist();
    const fresh = await send({ type: "draft" });
    if (!fresh || fresh.id !== draft.id) throw Error("This draft changed. Reopen it.");
    const kind = fresh.frozen ? "approved" : "source";
    let width = 0;
    let height = 0;
    for (let index = 0; index < fresh.capturePages.length; index++) {
      const blob = await getPage(fresh.id, index, kind);
      if (!blob) throw Error(`Screenshot ${index + 1} is missing from this browser.`);
      const bitmap = await createImageBitmap(blob);
      if (width && bitmap.width !== width) {
        bitmap.close();
        throw Error("Screenshot widths differ. Review the numbered images instead.");
      }
      width = bitmap.width;
      height += bitmap.height;
      bitmap.close();
    }
    const size = combinedImageSize(width, height);
    const overview = new OffscreenCanvas(size.width, size.height);
    const surface = overview.getContext("2d");
    if (!surface) throw Error("This browser cannot render the full-page preview.");
    let sourceTop = 0;
    for (let index = 0; index < fresh.capturePages.length; index++) {
      if (request !== previewBuild) return;
      const bitmap = await createImageBitmap(await getPage(fresh.id, index, kind));
      const top = Math.round((sourceTop / height) * size.height);
      sourceTop += bitmap.height;
      const bottom = Math.round((sourceTop / height) * size.height);
      surface.drawImage(bitmap, 0, top, size.width, bottom - top);
      if (!fresh.frozen) {
        surface.save();
        surface.translate(0, top);
        surface.scale(size.width / bitmap.width, (bottom - top) / bitmap.height);
        for (const shape of fresh.pageToolStates?.[index] || [])
          drawShape(shape, surface, bitmap.width);
        surface.restore();
      }
      bitmap.close();
    }
    const blob = await overview.convertToBlob({ type: "image/webp", quality: 0.82 });
    if (request !== previewBuild) return;
    previewUrl = URL.createObjectURL(blob);
    const image = document.createElement("img");
    image.id = "full-page-preview";
    image.alt = "Combined preview of all captured screenshot sections";
    $("preview-slot").append(image);
    image.src = previewUrl;
    await image.decode();
    if (request !== previewBuild) return;
    $("preview-slot").hidden = false;
    $("canvas").hidden = true;
    $("tools").hidden = true;
    $("series-guide").hidden = true;
    $("preview-guide").hidden = false;
    $("remove-current").hidden = true;
    toggle.textContent = "Back to sections";
    toggle.setAttribute("aria-pressed", "true");
    status(`Full page preview ready · ${fresh.capturePages.length} sections.`);
  } catch (error) {
    hideFullPagePreview();
    status(`Full-page preview could not open: ${error.message}`, "error");
  } finally {
    $("canvas-scroll").removeAttribute("aria-busy");
    toggle.disabled = false;
  }
}
function payload() {
  return {
    type: "saveDraft",
    id: draft.id,
    imageRevision: draft.imageRevision || 0,
    body: $("body").value,
    category: $("category").value,
    tags: $("tags").value,
    includeDiagnostics: $("include-diagnostics").checked,
    diagnosticsSelection: Object.fromEntries(
      ["console", "network"].map((kind) => [
        kind,
        [
          ...document.querySelectorAll(`input[data-diagnostic-kind="${kind}"]:checked`),
        ].map((input) => Number(input.value)),
      ]),
    ),
    projectId: $("project").value,
    noImage: $("no-image").checked,
    includeCombined: $("include-combined").checked,
    toolState: shapes,
    pageIndex,
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
function renderThumbnails(fresh) {
  thumbnailObserver?.disconnect();
  const list = $("page-thumbnails");
  const pages = fresh?.capturePages || [];
  list.hidden = !pages.length;
  list.replaceChildren();
  if (!pages.length) return;
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbnailObserver.unobserve(entry.target);
        const image = entry.target.querySelector("img");
        const index = Number(entry.target.dataset.index);
        const key = `${fresh.id}:${fresh.imageRevision}:${index}`;
        if (thumbnailCache.has(key)) {
          image.src = thumbnailCache.get(key);
          continue;
        }
        send({ type: "captureThumbnail", id: fresh.id, index })
          .then(({ image: source }) => {
            thumbnailCache.set(key, source);
            if (draft?.id === fresh.id && entry.target.isConnected) image.src = source;
          })
          .catch(() => {
            image.alt = "Preview unavailable; open this screenshot to review it.";
          });
      }
    },
    { root: list },
  );
  for (const [index, page] of pages.entries()) {
    const card = document.createElement("div");
    card.className = "page-thumbnail";
    card.dataset.index = String(index);
    card.setAttribute("role", "listitem");
    if (index === pageIndex) card.setAttribute("aria-current", "page");
    const open = document.createElement("button");
    open.type = "button";
    open.setAttribute("aria-label", `Review screenshot ${index + 1}: ${page.name}`);
    const image = document.createElement("img");
    image.alt = "";
    const label = document.createElement("strong");
    label.textContent = `Screenshot ${index + 1}`;
    const range = document.createElement("small");
    range.textContent = `${page.startY}–${page.endY}px`;
    open.append(image, label, range);
    open.onclick = () => changePage(index);
    card.append(open);
    list.append(card);
    thumbnailObserver.observe(card);
  }
}
async function removePage(index) {
  if (!draft || draft.frozen || loadingBase || redacting || sendingApproval) return;
  try {
    await persist();
    await send({
      type: "removeCapturePage",
      id: draft.id,
      index,
      imageRevision: draft.imageRevision,
    });
    if (pageIndex > index) pageIndex--;
    const fresh = await send({ type: "draft" });
    await loadBase(fresh);
    status(
      `${fresh.capturePages.length} screenshots remain. The removed image will not be sent.`,
    );
  } catch (error) {
    status(`Screenshot could not be removed: ${error.message}`, "error");
  }
}
async function loadBase(fresh) {
  hideFullPagePreview();
  if (draft && fresh && (fresh.imageRevision || 0) < (draft.imageRevision || 0)) return;
  const request = ++baseLoad;
  loadingBase = true;
  lock(true);
  $("send").disabled = true;
  base = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (draft?.id !== fresh?.id) pageIndex = 0;
  if (draft) draft.image = draft.approvedImage = null;
  draft = fresh;
  const pages = fresh?.capturePages || [];
  if (pageIndex >= pages.length) pageIndex = 0;
  $("image-review").classList.toggle("has-pages", pages.length > 1);
  $("series-guide").hidden = pages.length < 2;
  renderThumbnails(fresh);
  $("combine-option").hidden = pages.length < 2;
  $("include-combined").checked = !!fresh?.includeCombined && pages.length > 1;
  $("page-navigation").hidden = pages.length < 2;
  $("page-select").replaceChildren(
    ...pages.map(
      (page, index) =>
        new Option(`${page.name} · ${page.startY}–${page.endY}px`, String(index)),
    ),
  );
  $("page-select").value = String(pageIndex);
  $("page-prev").disabled = pageIndex === 0;
  $("page-next").disabled = pageIndex >= pages.length - 1;
  $("remove-current").hidden = !!fresh?.frozen;
  const scopeCopy =
    fresh?.captureScope === "fullPage"
      ? `${pages.length} ${pages.length === 1 ? "screenshot" : "screenshots"} in page order. Review and redact each image before sending. Sticky elements may repeat.`
      : "The screenshot covers the visible browser area. Review it before sending.";
  $("capture-scope").textContent = fresh?.captureNotice
    ? `${fresh.captureNotice} Sticky elements may repeat.`
    : scopeCopy;
  $("retry-capture").textContent =
    fresh?.captureScope === "fullPage"
      ? "Retry full-page capture"
      : "Retry capture on original tab";
  renderDiagnostics();
  if (!fresh) {
    shapes = [];
    lock(true);
    $("send").disabled = true;
    loadingBase = false;
    completed();
    return;
  }
  const pixels = pages.length
    ? (await send({ type: "capturePage", id: fresh.id, index: pageIndex })).image
    : fresh.approvedImage || fresh.image;
  if (pixels) {
    const decoded = new Image();
    decoded.src = pixels;
    await decoded.decode();
    if (request !== baseLoad) return;
    base = decoded;
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
  }
  shapes = pages.length
    ? fresh.frozen
      ? []
      : fresh.pageToolStates?.[pageIndex] || []
    : fresh.toolState || [];
  $("no-image").checked = !!fresh.noImage;
  $("retry-capture").hidden = (!fresh.captureError && !!pixels) || !!fresh.frozen;
  canvas.hidden = !pixels;
  current = null;
  render();
  loadingBase = false;
  lock(redacting || !!draft.frozen || sendingApproval);
  $("send").disabled = redacting || sendingApproval;
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
    const fresh = await send({
      type: "redactDraft",
      id: draft.id,
      rectangles,
      pageIndex,
    });
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
async function changePage(index) {
  if (
    !draft ||
    loadingBase ||
    redacting ||
    sendingApproval ||
    index < 0 ||
    index >= (draft.capturePages?.length || 0) ||
    index === pageIndex
  )
    return;
  try {
    if (!draft.frozen) await persist();
    const fresh = await send({ type: "draft" });
    pageIndex = index;
    await loadBase(fresh);
    status(`Reviewing ${fresh.capturePages[index].name}.`);
  } catch (error) {
    status(`Screenshot page could not be opened: ${error.message}`, "error");
  }
}
$("page-prev").onclick = () => changePage(pageIndex - 1);
$("page-next").onclick = () => changePage(pageIndex + 1);
$("full-page-toggle").onclick = () => {
  if ($("full-page-toggle").getAttribute("aria-pressed") === "true") {
    hideFullPagePreview();
    status(`Reviewing ${draft.capturePages[pageIndex].name}.`);
  } else showFullPagePreview();
};
$("remove-current").onclick = () => removePage(pageIndex);
$("page-select").onchange = () => changePage(Number($("page-select").value));
for (const id of [
  "body",
  "project",
  "no-image",
  "include-combined",
  "category",
  "tags",
  "include-diagnostics",
])
  $(id).oninput = schedule;
$("no-image").addEventListener("change", () => {
  canvas.style.opacity = $("no-image").checked ? ".35" : "1";
  $("include-combined").disabled = $("no-image").checked;
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
    "input,select,textarea,[data-tool],[data-diagnostic-mask],#undo,#reset,#remove-current",
  ))
    el.disabled = value;
  $("no-image").disabled = value || !base;
  $("include-combined").disabled = value || !base || $("no-image").checked;
  for (const el of document.querySelectorAll("[data-tool],#undo,#reset,#annotation"))
    el.disabled = value || !base;
  const pageLocked = loadingBase || redacting || sendingApproval;
  $("page-select").disabled = pageLocked;
  $("full-page-toggle").disabled = pageLocked;
  $("page-prev").disabled = pageLocked || pageIndex === 0;
  $("page-next").disabled =
    pageLocked || pageIndex >= (draft?.capturePages?.length || 0) - 1;
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
  if (!draft || redacting || loadingBase || sendingApproval) return;
  sendingApproval = true;
  $("send").disabled = true;
  $("discard").disabled = true;
  if (draft.capturePages?.length && !$("no-image").checked) {
    $("upload-progress").hidden = false;
    $("upload-meter").removeAttribute("value");
    $("upload-label").textContent = "Preparing screenshots…";
  }
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
      if (draft.capturePages?.length && !$("no-image").checked) {
        const fresh = await send({ type: "draft" });
        for (let index = 0; index < fresh.capturePages.length; index++) {
          pageIndex = index;
          await loadBase(fresh);
          render();
          status(`Approving ${fresh.capturePages[index].name}…`);
          await send({
            type: "approveCapturePage",
            id: fresh.id,
            imageRevision: approvalRevision,
            index,
            image: canvas.toDataURL("image/webp", 0.9),
          });
        }
      }
    }
    const result = await send({
      type: "submit",
      id: draft.id,
      imageRevision: approvalRevision,
      image:
        draft.frozen || draft.capturePages?.length
          ? undefined
          : canvas.toDataURL("image/png"),
    });
    sendingApproval = false;
    completed(result.url);
  } catch (e) {
    sendingApproval = false;
    const fresh = await send({ type: "draft" }).catch(() => null);
    if (fresh) await loadBase(fresh);
    if (fresh?.capturePages?.length && fresh.frozen && !fresh.noImage)
      uploadProgress(
        fresh.uploadIndex + (fresh.combinedUploaded ? 1 : 0),
        fresh.capturePages.length + (fresh.includeCombined ? 1 : 0),
      );
    else $("upload-progress").hidden = true;
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
function renderDiagnostics() {
  $("diagnostics-review").hidden = !draft?.diagnostics;
  $("include-diagnostics").checked = !!draft?.includeDiagnostics;
  const entries = $("diagnostics-entries");
  entries.replaceChildren();
  if (!draft?.diagnostics) return;
  for (const kind of ["console", "network"]) {
    const heading = document.createElement("h3");
    heading.textContent = `${kind === "console" ? "Console" : "Network"} (${draft.diagnostics[kind].length})`;
    entries.append(heading);
    for (const [index, entry] of draft.diagnostics[kind].entries()) {
      const label = document.createElement("label"),
        input = document.createElement("input"),
        text = document.createElement("span");
      label.className = "diagnostic-entry";
      input.type = "checkbox";
      input.value = String(index);
      input.dataset.diagnosticKind = kind;
      input.checked = draft.diagnosticsSelection
        ? draft.diagnosticsSelection[kind]?.includes(index)
        : true;
      input.onchange = schedule;
      text.textContent =
        kind === "console"
          ? `${entry.level} · ${entry.atMs} ms`
          : `${entry.type} · ${entry.status ?? "status unavailable"} · ${entry.durationMs} ms · ${entry.url}`;
      label.append(input, text);
      entries.append(label);
      if (kind === "console") {
        const message = document.createElement("textarea"),
          mask = document.createElement("button");
        message.className = "diagnostic-message";
        message.value = entry.message;
        message.readOnly = true;
        message.rows = 2;
        message.setAttribute("aria-label", `Console message ${index + 1}`);
        mask.type = "button";
        mask.dataset.diagnosticMask = "";
        mask.textContent = "Mask selected text";
        mask.disabled = !!draft.frozen;
        mask.onclick = async () => {
          if (!draft || draft.frozen || loadingBase) return;
          const start = message.selectionStart,
            end = message.selectionEnd;
          if (end <= start) {
            status("Select the private text in the message first.", "error");
            return;
          }
          mask.disabled = true;
          try {
            await persist();
            draft = await send({
              type: "redactDiagnostic",
              id: draft.id,
              index,
              start,
              end,
            });
            renderDiagnostics();
            status("Selected text masked in the local draft.");
          } catch (error) {
            status(error.message, "error");
            mask.disabled = false;
          }
        };
        entries.append(message, mask);
      }
    }
  }
}
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
  const pointNotes = $("point-notes");
  pointNotes.replaceChildren();
  const comments = draft.context.annotations || [];
  pointNotes.hidden = comments.length === 0;
  comments.forEach((item, index) => {
    const row = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = `Point ${index + 1}`;
    const note = document.createElement("p");
    note.textContent = item.body;
    row.append(heading, note);
    pointNotes.append(row);
  });
  $("body-label").textContent = comments.length
    ? "Overall comment (optional)"
    : "Comment";
  $("category").value = draft.category || "general";
  $("tags").value = (draft.tags || []).join(", ");
  renderDiagnostics();
  $("no-image").checked = draft.noImage;
  $("include-combined").checked = !!draft.includeCombined;
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
      draft.capturePages?.length && draft.uploadIndex === draft.capturePages.length
        ? `${draft.uploadIndex} numbered screenshots uploaded. Retry will finish the combined image and keep the same feedback thread.`
        : "Pending submission. Retry continues from the first unsent screenshot.",
    );
    if (draft.capturePages?.length && !draft.noImage)
      uploadProgress(
        (draft.uploadIndex || 0) + (draft.combinedUploaded ? 1 : 0),
        draft.capturePages.length + (draft.includeCombined ? 1 : 0),
      );
  } else if (draft.captureError) {
    status(
      `${draft.captureError} Your target context is saved. Continue without an image, or retry capture on the original tab.`,
      "error",
    );
  } else if (draft.pointCapture || comments.length) {
    status(
      `${comments.length || 1} point ${comments.length === 1 ? "comment" : "comments"} saved. Review the screenshot, then Send.`,
    );
  }
}
lock(true);
$("send").disabled = true;
init().catch((e) => {
  status(e.message, "error");
  $("send").disabled = true;
});
