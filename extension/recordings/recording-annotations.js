// Local screenshot comments belong to the capture, never to destination routing.
export function createRecordingAnnotations({
  chrome,
  capture,
  recordings,
  saveImage,
  readImage,
}) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  async function context(sender, allowStopped = false) {
    const scope = await capture.contextForControls(sender);
    if (!scope) throw Error("This page does not own the recording.");
    const s = await capture.status();
    if (!s || (!s.active && !allowStopped))
      throw Error("Start a recording with debug context before adding a point.");
    return s;
  }
  async function finish(sender, point) {
    const hidden = await chrome.tabs.sendMessage(sender.tab.id, {
      type: "prepareRecordingResume",
      annotationId: point.annotationId,
    });
    if (hidden?.error) throw Error(hidden.error);
    await capture.endAnnotation(point.annotationId);
    if (
      point.resumeAfter &&
      Number.isFinite(point.videoTimeMs) &&
      ["paused", "recording"].includes(recordings.info(sender.tab.id)?.state)
    )
      await recordings.control(sender, "resume");
    return {};
  }
  return {
    begin: (sender, message) =>
      serial(async () => {
        if (!/^[0-9a-f-]{36}$/.test(message.key || ""))
          throw Error("Select an element first.");
        const s = await context(sender);
        if (s.annotationPause) {
          if (s.annotationPause.key === message.key) return s.annotationPause;
          throw Error("Save or cancel the current point first.");
        }
        let native;
        let resumeAfter = true;
        if (s.recording.mode === "video") {
          native = recordings.info(sender.tab.id);
          if (!native || !["paused", "recording"].includes(native.state))
            throw Error("The video is not recording.");
          resumeAfter = native.state === "recording";
          if (resumeAfter) native = await recordings.control(sender, "pause");
          if (!Number.isFinite(native.sourceAtMs)) {
            if (resumeAfter) await recordings.control(sender, "resume");
            throw Error(
              "The video timeline is unavailable. Stop and start a new recording.",
            );
          }
        }
        try {
          return await capture.beginAnnotation({
            key: message.key,
            resumeAfter,
            ...(native ? { atMs: native.sourceAtMs, videoTimeMs: native.elapsedMs } : {}),
          });
        } catch (error) {
          if (native && resumeAfter)
            await recordings.control(sender, "resume").catch(() => {});
          throw error;
        }
      }),
    save: (sender, message) =>
      serial(async () => {
        const s = await context(sender, true);
        const point =
          s.annotationPause ||
          (s.lastAnnotation?.annotationId === message.annotationId
            ? s.lastAnnotation
            : null);
        if (
          !point ||
          point.annotationId !== message.annotationId ||
          point.key !== message.key
        )
          throw Error("Select the screenshot point again.");
        // Copy pixels into the capture namespace before persisting the event. A
        // later navigation or ordinary screenshot cleanup cannot remove them.
        if (!(s.annotations || []).some((a) => a.id === message.annotationId)) {
          await saveImage(s.recording.id, point, message.anchor, sender.tab.id);
          await capture.saveAnnotation(message);
        }
        return finish(sender, point);
      }),
    cancel: (sender, message) =>
      serial(async () => {
        const s = await context(sender, true);
        const point =
          s.annotationPause ||
          (s.lastAnnotation?.annotationId === message.annotationId
            ? s.lastAnnotation
            : null);
        if (!point || point.annotationId !== message.annotationId)
          throw Error("This point is no longer being edited.");
        return finish(sender, point);
      }),
    recoverNavigation: (sender) =>
      serial(async () => {
        const s = await capture.status();
        if (!s?.annotationPause || s.target.sourceTabId !== sender.tab.id) return;
        if (!(await capture.contextForControls(sender))) return;
        const point = s.annotationPause;
        await capture.endAnnotation(point.annotationId);
        if (point.resumeAfter && Number.isFinite(point.videoTimeMs))
          await recordings.control(sender, "resume");
        await capture.annotate(
          "annotations",
          "Navigation closed an unfinished screenshot comment. Saved points remain in the recording.",
        );
      }),
    list: () =>
      serial(async () => {
        const s = await capture.status();
        const items = [];
        for (const annotation of s?.annotations || [])
          items.push({
            ...annotation,
            imageBase64: await readImage(s.recording.id, annotation.id),
          });
        return { recordingId: s?.recording.id, items };
      }),
  };
}
