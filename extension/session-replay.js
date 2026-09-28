import { safeReplay } from "./session-review.js";

// Extension pages do not reliably enforce a late meta CSP in rrweb's about:blank
// frame. Admit only resource-free CSS; the complete capture remains unchanged.
const safeProperty =
  /^(?:display|visibility|position|top|right|bottom|left|inset(?:-(?:top|right|bottom|left))?|(?:min-|max-)?(?:width|height)|box-sizing|(?:margin|padding)(?:-(?:top|right|bottom|left))?|border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?|border-radius|overflow(?:-[xy])?|opacity|z-index|color|background-color|font-(?:size|weight|family|style)|line-height|letter-spacing|text-(?:align|decoration|transform|overflow|indent|shadow)|white-space|word-(?:break|wrap)|flex(?:-(?:basis|direction|grow|shrink|wrap|flow))?|grid-(?:template-(?:columns|rows|areas)|column|row|area|auto-(?:columns|rows|flow))|(?:row-|column-)?gap|align-(?:items|self|content)|justify-(?:content|items|self)|place-(?:items|self|content)|object-fit|vertical-align|transform|transform-origin|box-shadow)$/i;
const safeFunctions = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "calc",
  "min",
  "max",
  "clamp",
  "translate",
  "translatex",
  "translatey",
  "translate3d",
  "scale",
  "scalex",
  "scaley",
  "rotate",
  "skew",
  "skewx",
  "skewy",
  "matrix",
  "matrix3d",
]);

function safeDeclarationValue(value) {
  if (!/^[a-z\d\s#.,%+*/()\-]+$/i.test(value)) return false;
  for (const match of value.matchAll(/([a-z][a-z\d-]*)\s*\(/gi)) {
    if (!safeFunctions.has(match[1].toLowerCase())) return false;
  }
  return true;
}

function safeDeclarations(style) {
  const kept = [];
  for (const property of style) {
    if (!safeProperty.test(property)) continue;
    const value = style.getPropertyValue(property);
    if (safeDeclarationValue(value)) kept.push(`${property}:${value}`);
  }
  return kept.join(";");
}

function safeInlineStyle(value) {
  if (typeof value !== "string" || value.length > 200_000) return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`x{${value}}`);
    const rule = sheet.cssRules[0];
    return rule instanceof CSSStyleRule ? safeDeclarations(rule.style) : "";
  } catch {
    return "";
  }
}

function safeStylesheet(value) {
  if (typeof value !== "string" || value.length > 3_000_000) return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(value);
    const rules = (items) => {
      const kept = [];
      for (const rule of items) {
        if (rule instanceof CSSStyleRule) {
          const declarations = safeDeclarations(rule.style);
          if (declarations) kept.push(`${rule.selectorText}{${declarations}}`);
        } else if (
          rule instanceof CSSMediaRule &&
          /^[a-z\d\s:().,%\-]+$/i.test(rule.conditionText)
        ) {
          const nested = rules(rule.cssRules);
          if (nested) kept.push(`@media ${rule.conditionText}{${nested}}`);
        }
        // Imports, font faces, custom properties, keyframes and unknown at-rules
        // can fetch assets or synthesize resource-bearing values.
      }
      return kept.join("\n");
    };
    return rules(sheet.cssRules);
  } catch {
    return "";
  }
}

function scrubAttributes(attributes) {
  if (!attributes || typeof attributes !== "object") return;
  if ("style" in attributes) attributes.style = safeInlineStyle(attributes.style);
  if ("_cssText" in attributes) attributes._cssText = safeStylesheet(attributes._cssText);
  for (const key of Object.keys(attributes)) {
    if (
      /^(?:filter|clip-path|mask(?:-image)?|cursor|marker(?:-start|-mid|-end)?)$/i.test(
        key,
      )
    ) {
      delete attributes[key];
    } else if (/^(?:fill|stroke)$/i.test(key)) {
      const value = String(attributes[key] ?? "");
      if (
        !/^[a-z\d\s#.,%()\-]+$/i.test(value) ||
        /(?:url|image-set|var|attr|paint)\s*\(/i.test(value)
      )
        delete attributes[key];
    }
  }
}

export function sanitizeSessionReplay(events) {
  const styleTextIds = new Set();
  const styleElementIds = new Set();
  const mediaIds = new Set();
  function node(value, insideStyle = false) {
    if (!value || typeof value !== "object") return;
    if (value.type === 2 && /^(?:video|audio)$/i.test(String(value.tagName))) {
      const kind = String(value.tagName).toLowerCase();
      const original = value.attributes || {};
      mediaIds.add(value.id);
      value.tagName = "div";
      value.attributes = {
        ...(typeof original.id === "string" ? { id: original.id } : {}),
        class:
          `${String(original.class || "")} feedbacks-replay-media-placeholder`.trim(),
        ...(typeof original.style === "string" ? { style: original.style } : {}),
        "data-feedbacks-media":
          kind === "video"
            ? "Video pixels unavailable in DOM replay"
            : "Audio unavailable in DOM replay",
      };
      value.childNodes = [];
      scrubAttributes(value.attributes);
      return;
    }
    if (
      value.type === 2 &&
      /^(?:set|animate|animatecolor|animatemotion|animatetransform|discard|mpath)$/i.test(
        String(value.tagName),
      )
    ) {
      value.tagName = "g";
      value.attributes = {};
      value.childNodes = [];
      return;
    }
    const styleNode =
      insideStyle ||
      (value.type === 2 && String(value.tagName).toLowerCase() === "style");
    if (value.type === 2 && String(value.tagName).toLowerCase() === "style")
      styleElementIds.add(value.id);
    scrubAttributes(value.attributes);
    // rrweb serializes fetched link stylesheets as _cssText. The generic
    // resource scrubber turns <link> into <div>; restore only this inlined,
    // CSSOM-filtered form so rrweb can rebuild it as a local <style>.
    if (value.type === 2 && value.attributes?._cssText) {
      value.tagName = "link";
      value.attributes = { _cssText: value.attributes._cssText };
      value.childNodes = [];
      return;
    }
    if ((value.type === 3 || value.type === 4) && styleNode) {
      styleTextIds.add(value.id);
      value.textContent = safeStylesheet(value.textContent);
    }
    if (Array.isArray(value.childNodes)) {
      value.childNodes = value.childNodes.filter((child) => child?.type !== 0);
      for (const child of value.childNodes) node(child, styleNode);
    }
  }
  return safeReplay(events).filter((event) => {
    if (event.type === 7) return false; // rrweb asset events
    if (event.type === 2) node(event.data?.node);
    if (event.type !== 3) return true;
    const data = event.data;
    if (!data || typeof data !== "object") return false;
    if ([7, 8, 10, 13, 15].includes(data.source)) return false;
    if (data.source === 0) {
      // A captured child iframe's Document must never be rebuilt into rrweb's
      // own replay document after that iframe has been made inert.
      data.adds = (data.adds || []).filter((added) => added.node?.type !== 0);
      for (const added of data.adds || []) {
        if (
          added.node?.type === 2 &&
          String(added.node.tagName).toLowerCase() === "style"
        )
          styleElementIds.add(added.node.id);
      }
      for (const added of data.adds || [])
        node(added.node, styleElementIds.has(added.parentId));
      for (const change of data.attributes || []) {
        if (mediaIds.has(change.id)) {
          const next = change.attributes || {};
          change.attributes = {
            ...(typeof next.class === "string"
              ? {
                  class: `${next.class} feedbacks-replay-media-placeholder`.trim(),
                }
              : {}),
            ...(typeof next.style === "string" ? { style: next.style } : {}),
          };
        }
        scrubAttributes(change.attributes);
      }
      for (const change of data.texts || []) {
        if (styleTextIds.has(change.id) || styleElementIds.has(change.id))
          change.value = safeStylesheet(change.value);
      }
    }
    return true;
  });
}

export function installSessionReplay(Replayer) {
  const token = location.hash.slice(1);
  const root = document.getElementById("replay");
  let player;
  let offset = 0;
  const send = (type, extra = {}) => parent.postMessage({ token, type, ...extra }, "*");
  const policy = () => {
    const head = player?.iframe?.contentDocument?.head;
    if (!head) throw Error("Replay sandbox is unavailable");
    if (head.querySelector("[data-feedbacks-policy]")) return;
    const meta = head.ownerDocument.createElement("meta");
    meta.dataset.feedbacksPolicy = "true";
    meta.httpEquiv = "Content-Security-Policy";
    meta.content =
      "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; script-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    head.prepend(meta);
    const placeholderStyle = head.ownerDocument.createElement("style");
    placeholderStyle.textContent =
      ".feedbacks-replay-media-placeholder{position:relative!important;background-color:#18222d!important}.feedbacks-replay-media-placeholder::after{content:attr(data-feedbacks-media);position:absolute;top:16px;left:16px;right:16px;z-index:1;min-height:40px;display:flex;align-items:center;justify-content:center;padding:8px 12px;box-sizing:border-box;color:#e3e8ec;background:rgba(12,18,25,.82);font:500 13px/1.4 sans-serif;text-align:center;pointer-events:none}";
    head.append(placeholderStyle);
  };
  const scale = () => {
    const width = Number(player?.iframe?.width) || 1024;
    root.style.transform = `scale(${Math.min(1, innerWidth / width)})`;
  };
  window.addEventListener("resize", scale);
  window.addEventListener("message", (message) => {
    if (message.source !== parent || message.data?.token !== token) return;
    try {
      if (message.data.type === "load") {
        if (!Array.isArray(message.data.events) || message.data.events.length > 45_000)
          throw Error("Invalid replay event limit");
        const events = sanitizeSessionReplay(message.data.events);
        if (events.length < 2 || !events.some((event) => event.type === 2))
          throw Error("No complete DOM baseline was captured");
        player?.destroy();
        root.replaceChildren();
        const startedAt = Number(message.data.startedAt);
        offset = events[0].timestamp - startedAt;
        if (!Number.isFinite(offset)) throw Error("Invalid replay start time");
        player = new Replayer(events, {
          root,
          showWarning: false,
          showDebug: false,
          blockClass: "feedbacks-replay-block",
          UNSAFE_replayCanvas: false,
          mouseTail: false,
        });
        policy();
        player.on("fullsnapshot-rebuilded", () => {
          policy();
          scale();
        });
        player.pause(0);
        scale();
        send("loaded");
      } else if (
        message.data.type === "seek" &&
        player &&
        Number.isFinite(message.data.atMs)
      ) {
        player.pause(Math.max(0, message.data.atMs - offset));
        scale();
      }
    } catch (error) {
      send("error", { message: String(error.message).slice(0, 240) });
    }
  });
  send("ready");
}
