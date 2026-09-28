import { prepareCaptureOrigins } from "./session-origins.js";
import { createSessionReview } from "./session-review.js";
let inspector,
  inspectedRecording,
  annotationsReady = false;
const $ = (id) => document.getElementById(id);
const sourceTabId = Number(new URL(location.href).searchParams.get("sourceTabId"));
let target,
  current,
  busy = false,
  submitted = false;
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) throw Error(result.error);
  return result.data;
}
function status(text) {
  $("status").textContent = text;
}
async function render(s) {
  current = s;
  target = s?.target || target;
  if (target) $("target").textContent = `${target.url} · selected project`;
  const active = !!s?.active,
    recording = s?.recording;
  document.body.classList.toggle("session-stopped", !!recording && !active);
  document.querySelector("h1").textContent =
    recording && !active ? "Review session" : "Record a session";
  if (recording) {
    $("mask-inputs").checked = recording.privacy.maskInputs;
    $("mask-text").checked = recording.privacy.maskText;
    $("network-bodies").checked = recording.privacy.networkBodies;
  }
  $("start").disabled = !target || !!recording || busy || submitted;
  $("privacy").disabled = !!recording || busy;
  $("redirect-origins").disabled = !!recording || busy;
  $("stop").hidden = !active;
  $("return").hidden = !active;
  $("discard").hidden = !recording;
  $("review").hidden = !recording || active;
  if (active) {
    annotationsReady = false;
    status(
      `Recording · ${Math.floor((Date.now() - s.started) / 1000)} seconds · ${recording.events.length.toLocaleString()} events · ${(s.bytes / 1024 / 1024).toFixed(1)} MiB`,
    );
  } else if (recording) {
    $("summary").textContent =
      `${(recording.durationMs / 1000).toFixed(1)} seconds · ${recording.events.length.toLocaleString()} events · ${s.dropped || 0} dropped`;
    $("coverage").replaceChildren(
      ...recording.coverage.map((item) => {
        const li = document.createElement("li");
        li.textContent = `${item.channel}: ${item.status}. ${item.detail || ""}`;
        return li;
      }),
    );
    $("evidence").textContent = JSON.stringify(recording, null, 2);
    if (inspectedRecording !== recording.id) {
      annotationsReady = false;
      $("send").disabled = true;
      inspector?.dispose();
      try {
        const annotations = await send({ type: "recordingAnnotations" });
        if (current?.recording?.id !== recording.id) return;
        if (annotations.recordingId !== recording.id)
          throw Error(
            "Screenshot comments belong to another recording. Reload this review.",
          );
        inspector = createSessionReview($("capture-inspector"), {
          recording,
          annotations: annotations.items,
        });
        inspectedRecording = recording.id;
        annotationsReady = true;
        $("send").disabled = false;
      } catch (error) {
        if (current?.recording?.id !== recording.id) return;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Reload screenshot comments";
        retry.onclick = () =>
          void render(current).catch((error) => status(error.message));
        $("capture-inspector").hidden = false;
        $("capture-inspector").replaceChildren(retry);
        throw error;
      }
    }
    if (s.submission) {
      $("comment").value = s.submission.body;
      $("comment").readOnly = true;
    }
    status("Capture stopped. Inspect the context, then send or discard.");
  }
}
async function action(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    status(e.message);
  } finally {
    busy = false;
    $("send").disabled = !annotationsReady;
    if (!current?.recording) {
      $("privacy").disabled = false;
      $("redirect-origins").disabled = false;
      $("start").disabled = !target || submitted;
    }
  }
}
$("start").onclick = () =>
  action(async () => {
    const allowedOrigins = await prepareCaptureOrigins(
      target,
      $("redirect-origins").value,
    );
    render(
      await send({
        type: "sessionStart",
        target: { ...target, allowedOrigins },
        mode: "session",
        privacy: {
          maskText: $("mask-text").checked,
          maskInputs: $("mask-inputs").checked,
          networkBodies: $("network-bodies").checked,
        },
      }),
    );
    await chrome.tabs.update(target.sourceTabId, { active: true });
  });
$("return").onclick = () =>
  action(() => chrome.tabs.update(target.sourceTabId, { active: true }));
$("stop").onclick = () => action(async () => render(await send({ type: "sessionStop" })));
$("discard").onclick = () =>
  action(async () => {
    await send({ type: "sessionDiscard" });
    current = null;
    inspector?.dispose();
    inspectedRecording = null;
    annotationsReady = false;
    $("comment").readOnly = false;
    render(null);
    $("start").disabled = false;
    status("Session discarded.");
  });
$("send").onclick = () =>
  action(async () => {
    if (!annotationsReady) throw Error("Wait for screenshot comments to finish loading.");
    $("send").disabled = true;
    const result = await send({ type: "sessionSubmit", body: $("comment").value });
    submitted = true;
    current = null;
    $("review").hidden = true;
    $("discard").hidden = true;
    $("start").hidden = true;
    $("thread").href = result.url;
    $("thread").hidden = false;
    status("Session shared with the project.");
  });
send({ type: "sessionContext", sourceTabId })
  .then(render)
  .catch((e) => status(e.message));
setInterval(async () => {
  if (busy || submitted) return;
  try {
    const s = await send({ type: "sessionStatus" });
    if (s?.active || current?.active) await render(s);
  } catch (e) {
    status(e.message);
  }
}, 1000);
