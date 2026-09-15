/* Shared, bundled pure rules. No page data or credentials are stored here. */
globalThis.FeedbacksUtil = Object.freeze({
  safeUrl(value) {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol))
      throw Error("Open an HTTP or HTTPS website.");
    u.username = "";
    u.password = "";
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (
        /token|secret|password|passwd|auth|session|cookie|email|key|code|signature|jwt|credential/i.test(
          key,
        )
      )
        u.searchParams.delete(key);
    }
    u.searchParams.sort();
    return u.href;
  },
  server(value, allowLocal = false) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
      throw Error("Use only the Feedbacks server origin, without a path or credentials.");
    const local =
      /^(localhost|127(?:\.\d+){3}|\[::1\]|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})$/.test(
        u.hostname,
      ) ||
      (!u.hostname.includes(".") && !u.hostname.includes(":")) ||
      u.hostname.endsWith(".local");
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local && allowLocal))
      throw Error("Use HTTPS. Local HTTP requires the explicit local-server option.");
    return u.origin;
  },
  device(width) {
    return width < 600 ? "mobile" : width < 1000 ? "tablet" : "desktop";
  },
  widths: Object.freeze({ mobile: 390, tablet: 820, desktop: 1440 }),
  shortcut(event) {
    if (
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.repeat
    )
      return null;
    const target = event.composedPath?.()[0] || event.target;
    if (
      target?.isContentEditable ||
      target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]')
    )
      return null;
    return (
      { m: "mobile", t: "tablet", d: "desktop", w: "wide" }[event.key.toLowerCase()] ||
      null
    );
  },
  sameContext(saved, current) {
    return (
      this.safeUrl(saved.url) === this.safeUrl(current.url) &&
      this.device(saved.viewport.width) === this.device(current.viewport.width)
    );
  },
  pinVisible(thread, showResolved) {
    return !thread.archived && (showResolved || thread.pins.defaultVisible);
  },
});
