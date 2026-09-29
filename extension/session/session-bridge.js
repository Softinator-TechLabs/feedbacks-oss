// Serialized into the ISOLATED world. Page messages are evidence, never commands.
export function installSessionBridge(token) {
  globalThis.__feedbacksSessionBridgeStop?.();
  let count = 0,
    bytes = 0,
    closed = false;
  const ingest = (message) => {
    if (closed) return;
    if (
      !message ||
      message.channel !== "feedbacks-session-v1" ||
      message.token !== token ||
      !Array.isArray(message.events) ||
      message.events.length > 100
    )
      return;
    let length;
    try {
      length = new TextEncoder().encode(JSON.stringify(message.events)).byteLength;
    } catch {
      return;
    }
    if (
      length > 6 * 1024 * 1024 + 128 * 1024 ||
      (count += message.events.length) > 45000 ||
      (bytes += length) > 12 * 1024 * 1024
    ) {
      closed = true;
      void chrome.runtime
        .sendMessage({ type: "sessionBridgeLimit", token })
        .catch(() => {});
      return;
    }
    const events = message.events.filter(
      (e) =>
        e &&
        ["replay", "console", "activity", "network", "performance"].includes(e.type) &&
        e.data &&
        typeof e.data === "object",
    );
    void chrome.runtime
      .sendMessage({ type: "sessionEvents", token, events })
      .then((result) => {
        if (result?.ok)
          window.postMessage(
            {
              channel: "feedbacks-session-ack-v1",
              token,
              pageSeq: Math.max(
                0,
                ...events.map((event) =>
                  Number.isInteger(event.pageSeq) ? event.pageSeq : 0,
                ),
              ),
            },
            location.origin,
          );
      })
      .catch(() => {});
  };
  const listener = (event) => {
    if (event.source === window && event.origin === location.origin) ingest(event.data);
  };
  const criticalListener = (event) => {
    if (
      closed ||
      event.target !== window ||
      typeof event.detail !== "string" ||
      event.detail.length > 6 * 1024 * 1024 + 128 * 1024
    )
      return;
    try {
      ingest(JSON.parse(event.detail));
    } catch {}
  };
  window.addEventListener("message", listener);
  window.addEventListener("feedbacks-session-flush-v1", criticalListener);
  globalThis.__feedbacksSessionBridgeStop = () => {
    closed = true;
    window.removeEventListener("message", listener);
    window.removeEventListener("feedbacks-session-flush-v1", criticalListener);
  };
}
