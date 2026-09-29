(() => {
  const U = globalThis.FeedbacksUtil;
  const F = globalThis.FeedbacksFrames;
  const hash = (str) => {
    let h = 2166136261;
    for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16);
  };
  const localSelector = (element) => {
    const parts = [];
    for (
      let el = element;
      el && el !== element.ownerDocument.documentElement && parts.length < 8;
      el = el.parentElement
    ) {
      const tag = el.tagName.toLowerCase();
      if (
        el.id &&
        !/token|password|secret|session|auth/i.test(el.id) &&
        el.id.length < 80
      ) {
        parts.unshift(`${tag}#${CSS.escape(el.id)}`);
        break;
      }
      const siblings = [...(el.parentElement?.children || [])].filter(
        (e) => e.tagName === el.tagName,
      );
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(el) + 1})`);
    }
    return parts.join(" > ");
  };
  const selector = (element) => F.path(element, localSelector);
  function recordKey(element) {
    let uniqueAnchor;
    for (let el = element, depth = 0; el && depth < 12; el = el.parentElement, depth++) {
      for (const name of ["data-feedbacks-record-id", "data-record-id", "data-item-id"]) {
        const value = el.getAttribute(name);
        if (value === null) continue;
        if (
          !value ||
          value.length > 200 ||
          element.ownerDocument.querySelectorAll(`[${name}="${CSS.escape(value)}"]`)
            .length !== 1
        )
          return null;
        return hash(`${name}|${value}`);
      }
      if (el.matches('tr,li,article,[role="row"],[role="listitem"]')) return null;
      if (
        el !== element &&
        ["DIV", "SECTION"].includes(el.tagName) &&
        [...(el.parentElement?.children || [])].filter(
          (sibling) => sibling.tagName === el.tagName,
        ).length > 1
      )
        return null;
      if (
        el === element &&
        el.id &&
        el.id.length < 80 &&
        !/token|password|secret|session|auth/i.test(el.id) &&
        el.ownerDocument.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1
      )
        uniqueAnchor ||= `id:${hash(el.id)}`;
      if (
        el === element &&
        /^(HEADER|MAIN|FOOTER|NAV|H1|BUTTON)$/.test(el.tagName) &&
        el.ownerDocument.querySelectorAll(el.tagName).length === 1
      )
        uniqueAnchor ||= `tag:${el.tagName}`;
    }
    // null is an explicit ambiguity veto; undefined means no key was found.
    return uniqueAnchor || undefined;
  }
  // A unique heading on a document page is useful even without application
  // record attributes. Never use this fallback inside unkeyed repeatable rows.
  function headingFingerprint(el) {
    if (!/^H[1-6]$/.test(el.tagName) || el.isContentEditable) return null;
    if (el.closest('tr,li,article,[role="row"],[role="listitem"]')) return null;
    if (el.querySelector("input,textarea,select,[contenteditable]")) return null;
    const label = el.textContent.trim().replace(/\s+/g, " ");
    if (!label || label.length > 500) return null;
    const matches = [...el.ownerDocument.querySelectorAll(el.tagName)].filter(
      (candidate) => candidate.textContent.trim().replace(/\s+/g, " ") === label,
    );
    return matches.length === 1
      ? `heading-v1:${hash(`${el.tagName}|${label}|${selector(el)}`)}`
      : null;
  }
  const fingerprint = (el) => {
    const record = recordKey(el);
    if (record === null) return null;
    return record
      ? `record-v3:${hash(`${record}|${el.tagName}|${selector(el)}|${el.getAttribute("role") || ""}`)}`
      : headingFingerprint(el);
  };
  function context({
    chosen,
    annotations,
    mode,
    requested,
    captureMarkerStyle,
    captureMarkerSize,
    draftLocation,
  }) {
    const anchor = {
      confidence: "coordinate-only",
      screenshotPoint: { x: innerWidth / 2, y: innerHeight / 2 },
    };
    if (chosen && chosen.record === U.safeUrl(location.href)) {
      Object.assign(anchor, chosen.evidence);
      const el = chosen.element;
      const stable =
        el.isConnected && chosen.fingerprint && fingerprint(el) === chosen.fingerprint;
      anchor.confidence = stable && el.tagName !== "IFRAME" ? "element" : "unmatched";
      if (stable)
        Object.assign(
          anchor,
          targetEvidence(el, chosen.point, chosen.evidence.fingerprint),
        );
      else if (
        !chosen.fingerprint &&
        el.isConnected &&
        selector(el) === chosen.evidence.selector
      )
        Object.assign(
          anchor,
          targetEvidence(el, chosen.point, chosen.evidence.fingerprint),
        );
    }
    const saved = annotations.map(({ id, body, anchor }) => ({ id, body, anchor }));
    return {
      url: U.safeUrl(location.href),
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      scroll: { x: scrollX, y: scrollY },
      preset: mode,
      ...(requested ? { requestedSize: { width: requested, height: innerHeight } } : {}),
      capturedAt: new Date().toISOString(),
      captureMarker: { style: captureMarkerStyle, size: captureMarkerSize },
      anchor: saved[0]?.anchor || anchor,
      ...(saved.length
        ? {
            annotations: saved,
            pointEvidence: annotations.map(({ id, snapshot }) => ({ id, snapshot })),
            liveAnnotations: annotations.map((item) => {
              const location = draftLocation(item);
              return location.element &&
                (location.visible || location.reason === "Outside visible area")
                ? {
                    ...saved.find((entry) => entry.id === item.id),
                    anchor: {
                      ...targetEvidence(
                        location.element,
                        item.anchor.point,
                        item.anchor.fingerprint,
                      ),
                      confidence: item.anchor.confidence,
                    },
                  }
                : { id: item.id, body: item.body, anchor: {} };
            }),
          }
        : {}),
    };
  }
  function targetEvidence(el, point, evidenceFingerprint) {
    const r = F.rect(el),
      style = el.ownerDocument.defaultView.getComputedStyle(el),
      record = recordKey(el);
    return {
      tagName: el.tagName.toLowerCase(),
      selector: selector(el),
      fingerprint: evidenceFingerprint,
      ...(record ? { recordIdentity: record } : {}),
      point,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      screenshotPoint: {
        x: r.x + point.x * r.width,
        y: r.y + point.y * r.height,
      },
      pagePoint: {
        x: scrollX + r.x + point.x * r.width,
        y: scrollY + r.y + point.y * r.height,
      },
      styles: {
        fontFamily: style.fontFamily.slice(0, 200),
        fontSize: style.fontSize.slice(0, 50),
        color: style.color.slice(0, 100),
        backgroundColor: style.backgroundColor.slice(0, 100),
        borderWidth: style.borderWidth.slice(0, 100),
        borderStyle: style.borderStyle.slice(0, 100),
        borderColor: style.borderColor.slice(0, 100),
        borderRadius: style.borderRadius.slice(0, 100),
      },
    };
  }
  globalThis.FeedbacksReviewAnchors = {
    selector,
    fingerprint,
    targetEvidence,
    context,
  };
})();
