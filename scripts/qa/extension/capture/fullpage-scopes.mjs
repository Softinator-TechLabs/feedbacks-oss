import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export async function verifyFullpageScopes({
  fixture,
  page,
  toFixture,
  send,
  id,
  draft,
  results,
  root,
}) {
  for (const scope of ["short", "long", "tall", "tooLong", "clipped"]) {
    fixture.mode = scope;
    if (["tall", "tooLong"].includes(scope))
      await page.setViewportSize({ width: 1200, height: 800 });
    await toFixture();
    if (scope === "clipped") {
      const width = await page.evaluate(() => ({
        root: document.scrollingElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: innerWidth,
      }));
      assert.equal(width.root, width.viewport);
      assert.ok(width.body > width.viewport);
    }
    await page.evaluate(() => scrollTo(0, 120));
    const before = await page.evaluate(() => scrollY);
    const result = await send({ type: "popupAction", tabId: id, action: "capture-full" });
    const captured = await draft();
    results[scope] = {
      captured: result?.captured,
      scope: captured?.captureScope,
      hasImage: Boolean(captured?.image),
      pageCount: captured?.capturePages?.length || 0,
      firstName: captured?.capturePages?.[0]?.name,
      lastName: captured?.capturePages?.at(-1)?.name,
      notice: captured?.captureNotice,
      scrollRestored: Math.abs((await page.evaluate(() => scrollY)) - before) < 2,
    };
    assert.equal(result?.captured, true, JSON.stringify({ scope, error: result?.error }));
    if (
      ["long", "tall", "tooLong", "clipped"].includes(scope) &&
      captured?.capturePages?.length
    ) {
      const first = await send({ type: "capturePage", id: captured.id, index: 0 });
      const last = await send({
        type: "capturePage",
        id: captured.id,
        index: captured.capturePages.length - 1,
      });
      const pixels = Buffer.from(first.image.split(",")[1], "base64");
      const size = await sharp(pixels).metadata();
      results[scope].firstHeight = size.height;
      results[scope].lastHeight = (
        await sharp(Buffer.from(last.image.split(",")[1], "base64")).metadata()
      ).height;
      await mkdir(join(root, ".local/remaining-todos-qa"), { recursive: true });
      if (scope === "long")
        await writeFile(
          join(root, ".local/remaining-todos-qa/full-page-first.webp"),
          pixels,
        );
    }
    await send({ type: "discard" });
  }
}
