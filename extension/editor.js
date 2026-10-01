import {
  evidenceLayer,
  visibleShapes,
  withoutEvidenceLayers,
} from "./capture/evidence-layers.js";
import { getPage } from "./capture/page-store.js";
import {
  drawShape,
  paintScreenshot,
  prepareShapes,
  clearPreparedShapes,
  shapeRectangle,
} from "./capture/screenshot-render.js";
import { buildExportBlob, screenshotSurface } from "./capture/editor-export.js";
import { createDiagnosticEvidenceStore } from "./diagnostics/evidence-store.js";
import { cleanupPrivateDiagnosticArchives } from "./diagnostics/archive.js";
import { createEditorDiagnostics } from "./diagnostics/editor-panel.js";
import { createCaptureTriage } from "./capture-triage.js";

const $ = (id) => document.getElementById(id);
const diagnosticStore = createDiagnosticEvidenceStore();
void cleanupPrivateDiagnosticArchives().catch(() => {});
const send = async (message) => {
  const r = await chrome.runtime.sendMessage(message);
  if (!r.ok) throw Object.assign(Error(r.error), { code: r.code });
  return r.data;
};
const triage = createCaptureTriage($("capture-triage"), {
  load: (query) =>
    send({
      type: "captureTriage",
      server: draft?.server,
      projectId: $("project").value,
      ...query,
    }),
  onChange: () => schedule(),
});
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
let previewUrls = [];
let selectedImage = null;
let exportCrop = null;
let imageDrag = null;
let exporting = false;
let importing = false;
let previewBuild = 0;
const thumbnailCache = new Map();
const hiddenLayers = new Set(["element"]);
function layerControls() {
  const controls = $("evidence-layers");
  controls.hidden = !shapes.some(evidenceLayer);
  for (const button of controls.querySelectorAll("[data-layer]")) {
    const layer = button.dataset.layer;
    button.hidden = !shapes.some((shape) => evidenceLayer(shape) === layer);
    button.setAttribute("aria-pressed", String(!hiddenLayers.has(layer)));
    button.textContent = `${hiddenLayers.has(layer) ? "Show" : "Hide"} ${button.dataset.label}`;
  }
}
for (const button of $("evidence-layers").querySelectorAll("[data-layer]"))
  button.onclick = () => {
    const layer = button.dataset.layer;
    if (hiddenLayers.has(layer)) hiddenLayers.delete(layer);
    else hiddenLayers.add(layer);
    render();
    if (!$("preview-slot").hidden) void showFullPagePreview();
  };
function hideFullPagePreview() {
  previewBuild++;
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = [];
  $("preview-slot").replaceChildren();
  $("preview-slot").hidden = true;
  $("export-scope").value = "current";
  $("export-scope").hidden =
    (draft?.capturePages?.filter((page) => !page.annotationId).length || 0) < 2;
  $("page-navigation").removeAttribute("data-preview");
  $("page-prev").hidden = false;
  $("page-next").hidden = false;
  for (const [selector, label] of [
    ['[data-export="copy"]', "Copy image"],
    [".download-menu summary", "Download image"],
  ]) {
    const control = document.querySelector(selector);
    control.setAttribute("aria-label", label);
    control.title = label;
  }
  $("preview-guide").hidden = true;
  $("tools").hidden = false;
  document.querySelector(".text-label").hidden = tool !== "text";
  $("image-options").hidden = tool !== "image";
  $("sticker-options").hidden = tool !== "sticker";
  $("blur-help").hidden = tool !== "blur";
  $("crop-options").hidden = tool !== "crop" && !exportCrop;
  $("clear-crop").hidden = !exportCrop;
  $("full-page-toggle").textContent = "Full page preview";
  $("full-page-toggle").setAttribute("aria-pressed", "false");
  $("remove-current").hidden = !!draft?.frozen;
  $("canvas").hidden = !base;
  $("series-guide").hidden = (draft?.capturePages?.length || 0) < 2;
}
function setSendState(disabled, label) {
  for (const id of ["send", "send-header"]) {
    $(id).disabled = disabled;
    $(id).setAttribute("aria-busy", String(sendingApproval));
    if (!sendingApproval) $(id).style.removeProperty("--send-progress");
    if (label) $(id).querySelector("span").textContent = label;
  }
}
function uploadProgress(completed, total) {
  if (!Number.isInteger(total) || total < 1) return;
  const count = Math.min(total, Math.max(0, Number.isFinite(completed) ? completed : 0));
  const percent = Math.round((count / total) * 100);
  $("upload-progress").hidden = false;
  $("upload-meter").value = percent;
  $("upload-label").textContent = `${count} of ${total} images uploaded · ${percent}%`;
  if (sendingApproval) {
    setSendState(true, `Sending ${percent}%`);
    for (const id of ["send", "send-header"])
      $(id).style.setProperty("--send-progress", `${percent}%`);
  }
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
  $("review-actions").hidden = true;
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
function showPublishedThread(draft) {
  const link = $("published-thread");
  link.hidden = !draft?.thread;
  if (draft?.thread) link.href = `${draft.server}/threads/${draft.thread.id}`;
}
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "submitProgress" && message.id === draft?.id) {
    status(message.message);
    if (Number.isInteger(message.completed))
      uploadProgress(message.completed, message.total);
  }
});
function render(clean = false) {
  if (!base) return;
  layerControls();
  paintScreenshot(
    ctx,
    base,
    visibleShapes(shapes, hiddenLayers),
    canvas.width,
    canvas.height,
  );
  if (current)
    drawShape(
      current.tool === "crop" ? { ...current, tool: "rectangle" } : current,
      ctx,
      canvas.width,
    );
  if (!clean && exportCrop) {
    ctx.save();
    ctx.strokeStyle = "#2370b5";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(exportCrop.x, exportCrop.y, exportCrop.width, exportCrop.height);
    ctx.restore();
  }
  if (!clean && selectedImage && shapes.includes(selectedImage)) {
    const r = shapeRectangle(selectedImage);
    ctx.save();
    ctx.strokeStyle = "#2370b5";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.fillStyle = "#2370b5";
    ctx.fillRect(r.x + r.width - 8, r.y + r.height - 8, 16, 16);
    ctx.restore();
  }
}
function imageWithoutPins(type) {
  if (!base || !shapes.some(evidenceLayer)) return null;
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  paintScreenshot(
    output.getContext("2d"),
    base,
    withoutEvidenceLayers(shapes),
    output.width,
    output.height,
  );
  const image = output.toDataURL(type, type === "image/webp" ? 0.9 : undefined);
  output.width = output.height = 0;
  return image;
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
    const pageIndices = fresh.capturePages
      .map((page, index) => index)
      .filter((index) => !fresh.capturePages[index].annotationId);
    // Keep each section at source resolution. A single tall bitmap would force
    // narrow mobile captures through the combined upload attachment's size cap.
    const fragment = document.createDocumentFragment();
    for (const index of pageIndices) {
      if (request !== previewBuild) return;
      const output = await screenshotSurface(fresh, index, kind, hiddenLayers);
      const blob = await output.convertToBlob({ type: "image/png" });
      if (request !== previewBuild) return;
      const url = URL.createObjectURL(blob);
      previewUrls.push(url);
      const image = document.createElement("img");
      image.className = "full-page-section";
      image.alt = `Full page, screenshot ${index + 1}`;
      image.width = output.width;
      image.height = output.height;
      image.src = url;
      fragment.append(image);
      output.width = output.height = 0;
    }
    $("preview-slot").replaceChildren(fragment);
    $("export-scope").value = "full";
    $("export-scope").hidden = true;
    $("page-navigation").dataset.preview = "true";
    $("page-prev").hidden = true;
    $("page-next").hidden = true;
    for (const [selector, label] of [
      ['[data-export="copy"]', "Copy full page"],
      [".download-menu summary", "Download full page"],
    ]) {
      const control = document.querySelector(selector);
      control.setAttribute("aria-label", label);
      control.title = label;
    }
    $("zoom").onchange();
    $("preview-slot").hidden = false;
    $("canvas").hidden = true;
    $("tools").hidden = true;
    document.querySelector(".text-label").hidden = true;
    for (const id of ["image-options", "sticker-options", "blur-help", "crop-options"])
      $(id).hidden = true;
    $("series-guide").hidden = true;
    $("preview-guide").hidden = false;
    $("remove-current").hidden = true;
    toggle.textContent = "Edit section";
    toggle.setAttribute("aria-pressed", "true");
    status(
      `Full page preview ready · ${pageIndices.length} sections at original resolution.`,
    );
  } catch (error) {
    hideFullPagePreview();
    status(`Full-page preview could not open: ${error.message}`, "error");
  } finally {
    $("canvas-scroll").removeAttribute("aria-busy");
    toggle.disabled = false;
  }
}
async function exportPlan() {
  if (!base || !draft || redacting || loadingBase || sendingApproval)
    throw Error("Wait for the screenshot to finish loading.");
  if ($("export-scope").value === "full" && draft.capturePages?.length) {
    if (!draft.frozen) await persist();
    const fresh = await send({ type: "draft" });
    if (!fresh || fresh.id !== draft.id) throw Error("This draft changed. Reopen it.");
    const kind = fresh.frozen ? "approved" : "source",
      pages = [];
    // Inspect one source at a time before allocating a combined export canvas.
    for (const [index, page] of fresh.capturePages.entries()) {
      if (page.annotationId) continue;
      const blob = await getPage(fresh.id, index, kind);
      if (!blob) throw Error(`Screenshot ${index + 1} is missing from this browser.`);
      const bitmap = await createImageBitmap(blob);
      pages.push({
        width: bitmap.width,
        height: bitmap.height,
        render: () => screenshotSurface(fresh, index, kind, hiddenLayers),
      });
      bitmap.close();
    }
    return pages;
  }
  const crop = exportCrop && { ...exportCrop };
  return [
    {
      width: crop?.width || canvas.width,
      height: crop?.height || canvas.height,
      render: async () => {
        const output = new OffscreenCanvas(canvas.width, canvas.height);
        paintScreenshot(
          output.getContext("2d"),
          base,
          visibleShapes(shapes, hiddenLayers),
          canvas.width,
          canvas.height,
        );
        if (!crop) return output;
        const cropped = new OffscreenCanvas(crop.width, crop.height);
        cropped
          .getContext("2d")
          .drawImage(
            output,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            crop.width,
            crop.height,
          );
        output.width = output.height = 0;
        return cropped;
      },
    },
  ];
}
async function exportBlob(type) {
  return buildExportBlob(await exportPlan(), type);
}
for (const button of document.querySelectorAll("[data-export]"))
  button.onclick = async () => {
    if (exporting || importing || sendingApproval || redacting || loadingBase) return;
    exporting = true;
    const format = button.dataset.export;
    try {
      lock(true);
      setSendState(true);
      $("discard").disabled = true;
      status(
        format === "copy"
          ? "Copying the annotated screenshot…"
          : "Preparing the annotated download…",
      );
      if (format === "copy") {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
          throw Error("Image clipboard access is unavailable. Download PNG instead.");
        // Start clipboard.write in the click gesture; the PNG promise resolves later.
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": exportBlob("image/png") }),
        ]);
        status("Annotated screenshot copied to the clipboard.");
      } else {
        const type = format === "pdf" ? "application/pdf" : `image/${format}`;
        const blob = await exportBlob(type),
          url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `feedbacks-${$("export-scope").value === "full" ? "full-page" : `screenshot-${pageIndex + 1}`}.${format === "jpeg" ? "jpg" : format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        status(
          `${format.toUpperCase()} download ready${format === "pdf" ? " · one screenshot per PDF page" : " · original resolution"}.`,
        );
      }
    } catch (error) {
      status(error.message, "error");
    } finally {
      exporting = false;
      lock(!!draft?.frozen);
      setSendState(!draft || loadingBase || redacting || sendingApproval || importing);
      $("discard").disabled = false;
    }
  };
$("zoom").onchange = () => {
  $("canvas-scroll").dataset.zoom = $("zoom").value;
  const zoom = Number($("zoom").value);
  canvas.style.width = zoom ? `${canvas.width * zoom}px` : "";
  for (const image of $("preview-slot").querySelectorAll("img"))
    image.style.width = zoom ? `${Number(image.getAttribute("width")) * zoom}px` : "";
};
$("clear-crop").onclick = () => {
  exportCrop = null;
  $("clear-crop").hidden = true;
  $("crop-options").hidden = tool !== "crop";
  render();
};
$("add-image").onclick = () => $("image-file").click();
$("remove-image").onclick = () => {
  if (!selectedImage) {
    status("Click an inserted image to select it first.");
    return;
  }
  shapes = shapes.filter((shape) => shape !== selectedImage);
  selectedImage = null;
  render();
  schedule();
};
$("image-file").onchange = async () => {
  const file = $("image-file").files[0];
  $("image-file").value = "";
  if (!file || !base || draft?.frozen) return;
  const request = baseLoad;
  importing = true;
  lock(true);
  setSendState(true);
  $("discard").disabled = true;
  try {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 4 * 1024 * 1024
    )
      throw Error("Choose a PNG, JPEG or WebP image up to 4 MB.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / bitmap.width, 1024 / bitmap.height);
    const image = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    image.getContext("2d").drawImage(bitmap, 0, 0, image.width, image.height);
    bitmap.close();
    const blob = await image.convertToBlob({ type: "image/png" });
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error("Image could not be read."));
      reader.readAsDataURL(blob);
    });
    if (
      source.length +
        shapes
          .filter((s) => s.tool === "image")
          .reduce((sum, s) => sum + s.source.length, 0) >
      3 * 1024 * 1024
    )
      throw Error(
        "Inserted images exceed this screenshot's 3 MB draft limit. Choose a smaller image.",
      );
    const fit = Math.min(
      1,
      (canvas.width * 0.45) / image.width,
      (canvas.height * 0.45) / image.height,
    );
    const x = Math.round(canvas.width * 0.1),
      y = Math.round(canvas.height * 0.1);
    const shape = {
      tool: "image",
      source,
      points: [
        { x, y },
        { x: x + image.width * fit, y: y + image.height * fit },
      ],
    };
    await prepareShapes([shape]);
    if (request !== baseLoad || draft?.frozen) return;
    shapes.push(shape);
    selectedImage = shape;
    render();
    schedule();
    status("Image inserted. Drag to move; drag the bottom-right handle to resize.");
  } catch (error) {
    status(error.message, "error");
  } finally {
    importing = false;
    lock(!!draft?.frozen);
    setSendState(!draft || loadingBase || redacting || sendingApproval || exporting);
    $("discard").disabled = false;
  }
};
function payload() {
  if (shapes.length > 2000)
    throw Error(
      "This image has too many marks. Remove drawings or split this review before sending.",
    );
  const annotations = (draft.context.annotations || []).map((item, index) => ({
    id: item.id,
    body: item.textEdit
      ? item.body
      : $("point-notes").querySelectorAll("textarea")[index]?.value.trim() || "",
    ...(item.textEdit
      ? {
          replacement:
            $("point-notes").querySelectorAll("textarea")[index]?.value ??
            item.textEdit.replacement,
        }
      : {}),
  }));
  if (annotations.some((item) => !item.body))
    throw Error("Each point needs a comment before this draft can be saved.");
  if (
    annotations.some(
      (item, index) =>
        item.replacement !== undefined &&
        item.replacement === draft.context.annotations[index].textEdit.original,
    )
  )
    throw Error(
      "Change the replacement text, or leave it empty to remove the selection.",
    );
  return {
    type: "saveDraft",
    id: draft.id,
    imageRevision: draft.imageRevision || 0,
    body: $("body").value,
    annotations,
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
    triage: triage.value(),
    triageName: triage.label(),
    noImage: $("no-image").checked,
    includeCombined: $("include-combined").checked,
    toolState: shapes,
    pageIndex,
  };
}
function persist() {
  clearTimeout(saveTimer);
  if (!draft || draft.frozen) return saving;
  let message;
  try {
    message = payload();
  } catch (error) {
    dirty = true;
    status(error.message, "error");
    return Promise.reject(error);
  }
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
const markdownFormats = {
  bold: ["**", "**", "bold text"],
  italic: ["*", "*", "italic text"],
  link: ["[", "](https://example.com)", "link text"],
  list: ["- ", "", "list item"],
  code: ["`", "`", "code"],
};
document.querySelectorAll("[data-md-format]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    const textarea = $("body");
    const [prefix, suffix, placeholder] = markdownFormats[button.dataset.mdFormat];
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const content = textarea.value.slice(start, end) || placeholder;
    textarea.setRangeText(`${prefix}${content}${suffix}`, start, end, "select");
    textarea.focus();
    textarea.setSelectionRange(
      start + prefix.length,
      start + prefix.length + content.length,
    );
    schedule();
  });
});
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
  list.hidden = pages.length < 2;
  list.replaceChildren();
  if (pages.length < 2) return;
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
    label.textContent = page.annotationId
      ? `Point ${page.pointNumber} · Original view`
      : `Screenshot ${index + 1}`;
    const range = document.createElement("small");
    range.textContent = page.annotationId
      ? "At time of comment"
      : `${page.startY}–${page.endY}px`;
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
  setSendState(true);
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
  const continuousPages = pages.filter((page) => !page.annotationId);
  $("export-scope").hidden = continuousPages.length < 2;
  if (continuousPages.length < 2) $("export-scope").value = "current";
  $("series-guide").textContent =
    continuousPages.length > 1
      ? "Choose a section to annotate. Marks also appear in the combined full-page image."
      : "Choose a point’s original image to review, annotate or redact it.";
  $("combine-option").hidden = continuousPages.length < 2;
  $("full-page-toggle").hidden = continuousPages.length < 2;
  $("include-combined").checked = !!fresh?.includeCombined && continuousPages.length > 1;
  $("page-navigation").hidden = pages.length < 2;
  $("page-select").replaceChildren(
    ...pages.map(
      (page, index) =>
        new Option(
          page.annotationId ? `Point ${page.pointNumber} · Original view` : page.name,
          String(index),
        ),
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
  $("capture-scope").textContent = fresh?.captureNotice ? fresh.captureNotice : scopeCopy;
  $("retry-capture").textContent =
    fresh?.captureScope === "fullPage"
      ? "Retry full-page capture"
      : "Retry capture on original tab";
  renderDiagnostics();
  if (!fresh) {
    shapes = [];
    lock(true);
    setSendState(true);
    loadingBase = false;
    completed();
    return;
  }
  const capturedPage = pages.length
    ? await send({ type: "capturePage", id: fresh.id, index: pageIndex })
    : null;
  const pixels = capturedPage ? capturedPage.image : fresh.approvedImage || fresh.image;
  if (pixels) {
    const decoded = new Image();
    decoded.src = pixels;
    await decoded.decode();
    if (request !== baseLoad) return;
    base = decoded;
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    $("zoom").onchange();
  }
  selectedImage = null;
  exportCrop = null;
  $("crop-options").hidden = true;
  shapes = pages.length
    ? fresh.frozen
      ? capturedPage.evidenceLayers || []
      : fresh.pageToolStates?.[pageIndex] || []
    : fresh.toolState || [];
  clearPreparedShapes();
  await prepareShapes(shapes);
  $("no-image").checked = !!fresh.noImage;
  $("retry-capture").hidden = (!fresh.captureError && !!pixels) || !!fresh.frozen;
  canvas.hidden = !pixels;
  current = null;
  render();
  loadingBase = false;
  lock(redacting || !!draft.frozen || sendingApproval);
  setSendState(redacting || sendingApproval);
}
async function permanentRedaction(rectangles, migrate = false) {
  redacting = true;
  dirty = true;
  clearTimeout(saveTimer);
  lock(true);
  setSendState(true);
  $("discard").disabled = true;
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
    setSendState(!draft || loadingBase);
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
    x: Math.max(0, Math.min(canvas.width, ((e.clientX - r.x) * canvas.width) / r.width)),
    y: Math.max(
      0,
      Math.min(canvas.height, ((e.clientY - r.y) * canvas.height) / r.height),
    ),
  };
}
canvas.onpointerdown = (e) => {
  if (
    !draft ||
    draft.frozen ||
    exporting ||
    redacting ||
    loadingBase ||
    $("no-image").checked
  )
    return;
  if (tool === "text" && !$("annotation").value.trim()) {
    status("Write the text label first.");
    $("annotation").focus();
    return;
  }
  if (tool === "image") {
    const p = point(e);
    selectedImage = [...shapes].reverse().find((shape) => {
      if (shape.tool !== "image") return false;
      const r = shapeRectangle(shape);
      return (
        p.x >= r.x - 12 &&
        p.x <= r.x + r.width + 12 &&
        p.y >= r.y - 12 &&
        p.y <= r.y + r.height + 12
      );
    });
    if (selectedImage) {
      const r = shapeRectangle(selectedImage);
      imageDrag = {
        point: p,
        rect: r,
        resize:
          e.shiftKey ||
          (Math.abs(p.x - r.x - r.width) < 20 && Math.abs(p.y - r.y - r.height) < 20),
      };
      canvas.setPointerCapture(e.pointerId);
    }
    render();
    return;
  }
  selectedImage = null;
  if (
    tool === "steps" &&
    shapes.some((shape) => shape.tool === "steps" && shape.number >= 100)
  ) {
    status(
      "This screenshot already has 100 steps. Undo or reset steps before adding more.",
    );
    return;
  }
  current = {
    tool,
    ...(tool === "steps"
      ? {
          number:
            Math.max(
              0,
              ...shapes.filter((s) => s.tool === "steps").map((s) => s.number || 0),
            ) + 1,
        }
      : {}),
    ...(tool === "sticker" ? { text: $("sticker-choice").value } : {}),
    points: [point(e)],
    ...(tool === "text" ? { text: $("annotation").value.trim() } : {}),
  };
  canvas.setPointerCapture(e.pointerId);
  render();
};
canvas.onpointermove = (e) => {
  if (imageDrag && selectedImage) {
    const p = point(e),
      r = imageDrag.rect;
    if (imageDrag.resize) {
      const scale = Math.max(
        0.1,
        Math.min(
          (canvas.width - r.x) / r.width,
          (canvas.height - r.y) / r.height,
          (p.x - r.x) / r.width,
        ),
      );
      selectedImage.points = [
        { x: r.x, y: r.y },
        { x: r.x + r.width * scale, y: r.y + r.height * scale },
      ];
    } else {
      const x = Math.max(
        0,
        Math.min(canvas.width - r.width, r.x + p.x - imageDrag.point.x),
      );
      const y = Math.max(
        0,
        Math.min(canvas.height - r.height, r.y + p.y - imageDrag.point.y),
      );
      selectedImage.points = [
        { x, y },
        { x: x + r.width, y: y + r.height },
      ];
    }
    render();
    return;
  }
  if (!current || redacting || loadingBase) return;
  if (tool === "pencil") {
    if (current.points.length < 10000) current.points.push(point(e));
  } else current.points[1] = point(e);
  render();
};
canvas.onpointerup = () => {
  if (imageDrag) {
    imageDrag = null;
    schedule();
    return;
  }
  if (!current || redacting || loadingBase) return;
  if (current.tool === "crop") {
    const r = shapeRectangle(current);
    exportCrop = {
      x: Math.max(0, Math.floor(r.x)),
      y: Math.max(0, Math.floor(r.y)),
      width: Math.floor(Math.min(r.width, canvas.width - r.x)),
      height: Math.floor(Math.min(r.height, canvas.height - r.y)),
    };
    current = null;
    if (exportCrop.width < 1 || exportCrop.height < 1) {
      exportCrop = null;
      render();
      return;
    }
    $("export-scope").value = "current";
    $("crop-options").hidden = false;
    $("clear-crop").hidden = false;
    render();
    status(
      "Export crop selected. Copy and downloads use this area; sent feedback keeps the complete screenshot.",
    );
    return;
  }
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
  if (imageDrag && selectedImage) {
    const r = imageDrag.rect;
    selectedImage.points = [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
    ];
  }
  imageDrag = null;
  current = null;
  render();
};
for (const b of document.querySelectorAll("[data-tool]"))
  b.onclick = () => {
    tool = b.dataset.tool;
    selectedImage = null;
    $("image-options").hidden = tool !== "image";
    $("sticker-options").hidden = tool !== "sticker";
    $("blur-help").hidden = tool !== "blur";
    $("crop-options").hidden = tool !== "crop" && !exportCrop;
    $("clear-crop").hidden = !exportCrop;
    render();
    document.querySelector(".text-label").hidden = tool !== "text";
    $("tools").querySelector(".more-tools").open = false;
    if (tool === "text") $("annotation").focus();
    for (const sibling of document.querySelectorAll("[data-tool]"))
      sibling.setAttribute("aria-pressed", String(sibling === b));
  };
$("undo").onclick = () => {
  if (!draft?.frozen && !redacting) {
    selectedImage = null;
    const index = shapes.findLastIndex((shape) => !evidenceLayer(shape));
    if (index >= 0) shapes.splice(index, 1);
    render();
    schedule();
  }
};
$("reset").onclick = () => {
  if (!draft?.frozen && !redacting) {
    shapes = shapes.filter(evidenceLayer);
    $("tools").querySelector(".more-tools").open = false;
    render();
    schedule();
  }
};
async function changePage(index) {
  if (
    !draft ||
    loadingBase ||
    redacting ||
    exporting ||
    importing ||
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
$("project").addEventListener("change", () => {
  loadProjectCategories("general");
  triage.reset();
  schedule();
});
$("no-image").addEventListener("change", () => {
  canvas.style.opacity = $("no-image").checked ? ".35" : "1";
  $("include-combined").disabled = $("no-image").checked;
});
$("discard").onclick = async () => {
  if (exporting || importing || redacting || sendingApproval) return;
  if (!confirm("Discard this local draft and its screenshot?")) return;
  clearTimeout(saveTimer);
  await saving.catch(() => {});
  await send({ type: "discard" });
  window.close();
};
function lock(value) {
  value = value || importing || exporting;
  for (const el of document.querySelectorAll(
    "input,select,textarea,[data-tool],[data-md-format],[data-diagnostic-mask],#undo,#reset,#remove-current,#clear-crop",
  ))
    el.disabled = value;
  triage.setDisabled(value);
  $("no-image").disabled = value || !base;
  $("include-combined").disabled = value || !base || $("no-image").checked;
  for (const el of document.querySelectorAll("[data-tool],#undo,#reset,#annotation"))
    el.disabled = value || !base;
  const pageLocked =
    loadingBase || redacting || sendingApproval || exporting || importing;
  for (const el of document.querySelectorAll("[data-export]"))
    el.disabled = pageLocked || !base || exporting;
  $("add-image").disabled = value || !base;
  $("remove-image").disabled = value || !base;
  $("export-scope").disabled = pageLocked;
  $("zoom").disabled = false;
  $("page-select").disabled = pageLocked;
  $("full-page-toggle").disabled = pageLocked;
  $("page-prev").disabled = pageLocked || pageIndex === 0;
  $("page-next").disabled =
    pageLocked || pageIndex >= (draft?.capturePages?.length || 0) - 1;
}
$("retry-capture").onclick = async () => {
  if (!draft || draft.frozen || exporting || importing) return;
  $("retry-capture").disabled = true;
  try {
    await persist();
    lock(true);
    setSendState(true);
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
    setSendState(!draft || loadingBase);
    $("retry-capture").disabled = false;
  }
};
$("send").onclick = $("send-header").onclick = async () => {
  if (!draft || redacting || loadingBase || sendingApproval || exporting || importing)
    return;
  sendingApproval = true;
  setSendState(true, "Sending…");
  for (const id of ["send", "send-header"])
    $(id).style.setProperty("--send-progress", "0%");
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
      render(true);
      if (draft.capturePages?.length && !$("no-image").checked) {
        const fresh = await send({ type: "draft" });
        for (let index = 0; index < fresh.capturePages.length; index++) {
          pageIndex = index;
          await loadBase(fresh);
          render(true);
          status(`Approving ${fresh.capturePages[index].name}…`);
          await send({
            type: "approveCapturePage",
            id: fresh.id,
            imageRevision: approvalRevision,
            index,
            image: canvas.toDataURL("image/webp", 0.9),
            imageWithoutPins: imageWithoutPins("image/webp"),
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
      imageWithoutPins:
        draft.frozen || draft.capturePages?.length
          ? undefined
          : imageWithoutPins("image/png"),
    });
    sendingApproval = false;
    completed(result.url);
  } catch (e) {
    sendingApproval = false;
    const fresh = await send({ type: "draft" }).catch(() => null);
    if (fresh) await loadBase(fresh);
    showPublishedThread(fresh);
    if (fresh?.capturePages?.length && fresh.frozen && !fresh.noImage)
      uploadProgress(
        (fresh.uploadIndex || 0) + (fresh.combinedUploaded ? 1 : 0),
        fresh.capturePages.length + (fresh.includeCombined ? 1 : 0),
      );
    else $("upload-progress").hidden = true;
    lock(!draft || loadingBase || !!draft?.frozen);
    status(
      fresh
        ? fresh.thread
          ? `${e.message} The feedback thread is already published; some images are pending. Retry Send to finish them. Thread: ${fresh.server}/threads/${fresh.thread.id}`
          : `${e.message} Your draft is kept here. Review it before retrying Send.`
        : `${e.message} No local draft remains. Check Feedbacks for any completed submission.`,
      "error",
    );
    setSendState(!draft || loadingBase, "Retry Send");
    $("discard").disabled = false;
    $("status").scrollIntoView({ block: "nearest" });
  }
};
addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
const renderDiagnostics = createEditorDiagnostics({
  diagnosticStore,
  getDraft: () => draft,
  setDraft: (value) => {
    draft = value;
  },
  isLoadingBase: () => loadingBase,
  send,
  persist,
  schedule,
  status,
});
let projectCategories = new Map();
function loadProjectCategories(selected = "general") {
  const field = $("category");
  field.replaceChildren();
  const categories = [
    { id: "general", name: "General" },
    { id: "visualDesign", name: "Visual design" },
    { id: "productWorkflow", name: "Product workflow" },
    { id: "usabilityAccessibility", name: "Usability & accessibility" },
    ...(projectCategories.get($("project").value) || []),
  ];
  for (const category of categories)
    if (!category.archived || category.id === selected)
      field.add(
        new Option(
          category.archived ? `${category.name} (archived)` : category.name,
          category.id,
        ),
      );
  field.value = [...field.options].some((option) => option.value === selected)
    ? selected
    : "general";
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
    if (
      p.permissions.canWrite &&
      (p.origins.includes(origin) || p.captureMode === "any")
    ) {
      $("project").add(new Option(p.name, p.id));
      projectCategories.set(p.id, p.taxonomy?.categories || []);
    }
  $("project").value = draft.projectId;
  triage.reset(draft.triage, draft.triageName);
  loadProjectCategories(draft.category || "general");
  $("body").value = draft.body;
  const pointNotes = $("point-notes");
  pointNotes.replaceChildren();
  const comments = draft.context.annotations || [];
  pointNotes.hidden = comments.length === 0;
  comments.forEach((item, index) => {
    const row = document.createElement("li");
    const heading = document.createElement("div");
    heading.className = "point-note-heading";
    const label = document.createElement("label");
    label.htmlFor = `point-note-${index}`;
    label.textContent = `Point ${index + 1}${item.textEdit ? " · Suggested replacement" : ""}`;
    heading.append(label);
    const imageIndex = (draft.capturePages || []).findIndex(
      (page) => page.annotationId === item.id,
    );
    if (imageIndex >= 0) {
      const original = document.createElement("button");
      original.type = "button";
      original.textContent = "View original image";
      original.onclick = () => {
        const index = draft.capturePages.findIndex(
          (page) => page.annotationId === item.id,
        );
        if (index >= 0) changePage(index);
      };
      heading.append(original);
    }
    row.append(heading);
    const note = document.createElement("textarea");
    note.id = `point-note-${index}`;
    note.value = item.textEdit ? item.textEdit.replacement : item.body;
    if (item.textEdit) {
      const original = document.createElement("blockquote");
      original.className = "text-edit-original";
      original.setAttribute("aria-label", "Original text");
      original.textContent = item.textEdit.original;
      row.append(original);
      note.placeholder = "Empty replacement removes the selected text";
    }
    note.rows = 2;
    note.maxLength = 4000;
    note.required = !item.textEdit;
    note.addEventListener("input", schedule);
    row.append(note);
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
  setSendState(false);
  if (draft.frozen) {
    showPublishedThread(draft);
    setSendState(!draft || loadingBase, "Retry Send");
    status(
      draft.thread
        ? `Feedback thread already published. Retry Send to finish pending images without creating a second thread. ${draft.server}/threads/${draft.thread.id}`
        : draft.capturePages?.length && draft.uploadIndex === draft.capturePages.length
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
setSendState(true);
init().catch((e) => {
  status(e.message, "error");
  setSendState(true);
});
