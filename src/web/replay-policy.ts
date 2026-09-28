export const REPLAY_RESOURCE_POLICY =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'";

// Apply before rrweb receives its first play/seek command. rrweb's document.open()
// removes this meta element during a snapshot rebuild, but Chromium retains the
// document's active policy; restore the marker after each rebuild as well.
export function installReplayResourcePolicy(frame: HTMLIFrameElement): void {
  const head = frame.contentDocument?.head;
  if (!head) throw new Error("Replay sandbox document is unavailable");
  if (head.querySelector('meta[data-feedbacks-replay-policy="true"]')) return;
  const meta = head.ownerDocument.createElement("meta");
  meta.setAttribute("data-feedbacks-replay-policy", "true");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", REPLAY_RESOURCE_POLICY);
  head.prepend(meta);
  const placeholderStyle = head.ownerDocument.createElement("style");
  placeholderStyle.textContent =
    ".feedbacks-replay-media-placeholder{position:relative!important;background-color:#18222d!important}.feedbacks-replay-media-placeholder::after{content:attr(data-feedbacks-media);position:absolute;top:16px;left:16px;right:16px;z-index:1;min-height:40px;display:flex;align-items:center;justify-content:center;padding:8px 12px;box-sizing:border-box;color:#e3e8ec;background:rgba(12,18,25,.82);font:500 13px/1.4 sans-serif;text-align:center;pointer-events:none}";
  head.append(placeholderStyle);
}
