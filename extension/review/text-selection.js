// Read only explicit selections. Never collect editable or hidden page content.
(() => {
  if (globalThis.FeedbacksTextSelection) return;
  const excluded =
    'input,textarea,select,script,style,[hidden],[aria-hidden="true"],[data-feedbacks-private]';
  function eligible(element, host) {
    if (
      !element?.isConnected ||
      element === host ||
      element.getRootNode().host === host ||
      element.closest(excluded) ||
      element.isContentEditable
    )
      return false;
    for (
      let node = element;
      node;
      node = node.parentElement || node.ownerDocument.defaultView.frameElement
    ) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility !== "visible" ||
        style.opacity === "0" ||
        node.matches(excluded) ||
        node.isContentEditable
      )
        return false;
    }
    return true;
  }
  function rectangles(range, element, visibleOnly = true) {
    const common = range.commonAncestorContainer;
    const root = common.nodeType === 1 ? common : common.parentElement;
    const walker = root.ownerDocument.createTreeWalker(
      root,
      root.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
    );
    const seen = new Set(),
      boxes = [];
    let node,
      visited = 0;
    while ((node = walker.nextNode())) {
      if (++visited > 2000) return [];
      if (!range.intersectsNode(node)) continue;
      const piece = range.cloneRange();
      piece.selectNodeContents(node);
      if (node === range.startContainer) piece.setStart(node, range.startOffset);
      if (node === range.endContainer) piece.setEnd(node, range.endOffset);
      if (piece.collapsed) continue;
      let target = node.parentElement;
      while (
        target.parentElement &&
        (!target.getBoundingClientRect().width || !target.getBoundingClientRect().height)
      )
        target = target.parentElement;
      const local = target.getBoundingClientRect();
      const mapped = globalThis.FeedbacksFrames.rect(target);
      const sx = local.width ? mapped.width / local.width : 1;
      const sy = local.height ? mapped.height / local.height : 1;
      const clip = {
        left: visibleOnly ? 0 : -Infinity,
        top: visibleOnly ? 0 : -Infinity,
        right: visibleOnly ? innerWidth : Infinity,
        bottom: visibleOnly ? innerHeight : Infinity,
      };
      const bound = (box, axisX, axisY) => {
        const r = globalThis.FeedbacksFrames.rect(box);
        const scaleX = box.offsetWidth ? r.width / box.offsetWidth : 1;
        const scaleY = box.offsetHeight ? r.height / box.offsetHeight : 1;
        if (axisX) {
          clip.left = Math.max(clip.left, r.x + box.clientLeft * scaleX);
          clip.right = Math.min(
            clip.right,
            r.x + (box.clientLeft + box.clientWidth) * scaleX,
          );
        }
        if (axisY) {
          clip.top = Math.max(clip.top, r.y + box.clientTop * scaleY);
          clip.bottom = Math.min(
            clip.bottom,
            r.y + (box.clientTop + box.clientHeight) * scaleY,
          );
        }
      };
      for (let ancestor = target; ancestor; ) {
        const doc = ancestor.ownerDocument;
        // The outer document is scrolled section-by-section for a full-page capture.
        if (ancestor !== doc.documentElement && ancestor !== doc.body) {
          const style = doc.defaultView.getComputedStyle(ancestor);
          if (!["inline", "contents"].includes(style.display))
            bound(
              ancestor,
              /^(auto|scroll|hidden|clip)$/.test(style.overflowX),
              /^(auto|scroll|hidden|clip)$/.test(style.overflowY),
            );
        }
        if (ancestor.parentElement) ancestor = ancestor.parentElement;
        else {
          ancestor = doc.defaultView.frameElement;
          if (ancestor) bound(ancestor, true, true);
        }
      }
      for (const rect of piece.getClientRects()) {
        const x = Math.max(clip.left, mapped.x + (rect.x - local.x) * sx);
        const y = Math.max(clip.top, mapped.y + (rect.y - local.y) * sy);
        const right = Math.min(clip.right, mapped.x + (rect.right - local.x) * sx);
        const bottom = Math.min(clip.bottom, mapped.y + (rect.bottom - local.y) * sy);
        if (right <= x || bottom <= y) continue;
        const box = { x, y, width: right - x, height: bottom - y };
        const key = JSON.stringify(box);
        if (!seen.has(key)) {
          seen.add(key);
          boxes.push(box);
        }
      }
    }
    return boxes;
  }

  function read(doc, host) {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0).cloneRange();
    const original = range.toString();
    if (!original.trim() || original.length > 4000) return null;
    const common = range.commonAncestorContainer;
    let element = common.nodeType === 1 ? common : common.parentElement;
    if (!eligible(element, host)) return null;
    const walker = doc.createTreeWalker(element, doc.defaultView.NodeFilter.SHOW_TEXT);
    let node,
      visited = 0;
    while ((node = walker.nextNode())) {
      if (++visited > 2000) return null;
      if (range.intersectsNode(node) && !eligible(node.parentElement, host)) return null;
    }
    // display:contents has no box; retain the Range but target a visible ancestor.
    while (
      element &&
      (!element.getBoundingClientRect().width || !element.getBoundingClientRect().height)
    )
      element = element.parentElement;
    if (!eligible(element, host)) return null;
    const rects = rectangles(range, element, false);
    const visible = rectangles(range, element);
    if (
      !rects.length ||
      rects.length > 100 ||
      !visible.length ||
      rects.some(
        (rect) =>
          Math.abs(rect.x) > 20000 ||
          Math.abs(rect.y) > 20000 ||
          rect.width > 20000 ||
          rect.height > 20000,
      )
    )
      return null;
    return { element, range, original, rects, actionRect: visible.at(-1) };
  }
  globalThis.FeedbacksTextSelection = { read, rectangles };
})();
