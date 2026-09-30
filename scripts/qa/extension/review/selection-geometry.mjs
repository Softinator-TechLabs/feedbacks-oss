import assert from "node:assert/strict";

export async function verifySelectionGeometry(worker, tabId) {
  const result = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const root = globalThis.__feedbacksQaRoot;
        const fixture = document.createElement("div");
        fixture.style.cssText =
          "position:fixed;top:8px;left:8px;width:200px;font:16px/20px Arial;background:white";
        fixture.textContent = "Review page copy ".repeat(100);
        document.body.append(fixture);
        const select = (doc, element) => {
          const range = doc.createRange();
          range.selectNodeContents(element);
          const selection = doc.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return range;
        };
        const range = select(document, fixture);
        const reader = globalThis.FeedbacksTextSelection;
        const full = reader.rectangles(range, fixture, false);
        const visible = reader.rectangles(range, fixture);
        const saved = reader.read(document, root.host);
        const fullBottom = Math.max(...full.map((r) => r.y + r.height));
        const visibleBottom = Math.max(...visible.map((r) => r.y + r.height));
        fixture.textContent = "";
        const contents = document.createElement("span");
        contents.style.display = "contents";
        contents.textContent = "Visible boxless text";
        fixture.append(contents);
        select(document, contents);
        const boxless = reader.read(document, root.host);
        const boxlessWidth = boxless.element.getBoundingClientRect().width;
        const inline = document.createElement("span");
        inline.style.overflow = "hidden";
        inline.textContent = "Ordinary inline text";
        fixture.replaceChildren(inline);
        select(document, inline);
        const inlineSelection = reader.read(document, root.host);
        const frame = document.createElement("iframe");
        frame.style.cssText =
          "position:fixed;top:100px;left:300px;width:200px;height:120px;border:3px solid black";
        frame.srcdoc =
          '<body style="margin:0;font:16px/20px Arial"><p style="margin:0">' +
          "Iframe selected text ".repeat(40) +
          "</p></body>";
        const loaded = new Promise((done) => (frame.onload = done));
        document.body.append(frame);
        await loaded;
        const paragraph = frame.contentDocument.querySelector("p");
        select(frame.contentDocument, paragraph);
        const framed = reader.read(frame.contentDocument, root.host);
        const clip = frame.getBoundingClientRect();
        const frameBottom =
          clip.y +
          ((frame.clientTop + frame.clientHeight) * clip.height) / frame.offsetHeight;
        const selectedBottom = Math.max(...framed.rects.map((r) => r.y + r.height));
        frame.style.transformOrigin = "top left";
        frame.style.transform = "scale(0.5)";
        const transformed = reader.read(frame.contentDocument, root.host);
        const scaledClip = frame.getBoundingClientRect();
        const scaledBottom =
          scaledClip.y +
          ((frame.clientTop + frame.clientHeight) * scaledClip.height) /
            frame.offsetHeight;
        const scaledSelectedBottom = Math.max(
          ...transformed.rects.map((r) => r.y + r.height),
        );
        const scroller = document.createElement("div");
        scroller.style.cssText =
          "position:fixed;top:8px;left:500px;width:200px;height:100px;overflow:auto;font:16px/20px Arial;border:1px solid black";
        const scrollText = document.createElement("p");
        scrollText.style.margin = "0";
        scrollText.textContent = "Clipped selection text ".repeat(70);
        scroller.append(scrollText);
        document.body.append(scroller);
        select(document, scrollText);
        const clipped = reader.read(document, root.host);
        const scrollBottom =
          scroller.getBoundingClientRect().y + scroller.clientTop + scroller.clientHeight;
        const clippedBottom = Math.max(...clipped.rects.map((r) => r.y + r.height));
        scroller.remove();
        document.getSelection().removeAllRanges();
        fixture.remove();
        frame.remove();
        return {
          fullBottom,
          visibleBottom,
          savedCount: saved.rects.length,
          fullCount: full.length,
          boxlessWidth,
          inlineText: inlineSelection?.original,
          selectedBottom,
          frameBottom,
          scaledBottom,
          scaledSelectedBottom,
          scrollBottom,
          clippedBottom,
        };
      },
    });
    return entry.result;
  }, tabId);
  assert.ok(result.fullBottom > 650);
  assert.ok(result.visibleBottom <= 650);
  assert.equal(
    result.savedCount,
    result.fullCount,
    "original selection geometry must include offscreen lines for full-page capture",
  );
  assert.ok(result.boxlessWidth > 0, "boxless text must target a visible ancestor");
  assert.equal(result.inlineText, "Ordinary inline text");
  assert.ok(result.selectedBottom <= result.frameBottom);
  assert.ok(result.scaledSelectedBottom <= result.scaledBottom);
  assert.ok(result.clippedBottom <= result.scrollBottom);
  return { fullPageSelection: true, iframeClipping: true };
}
