import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, stat, mkdir, readdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
const root = resolve("dist/site");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".xml": "application/xml",
};
async function localFile(url) {
  const name = resolve(
    root,
    "." + decodeURIComponent(new URL(url, "http://local").pathname),
  );
  if (name !== root && !name.startsWith(root + sep)) return null;
  for (const path of [name, resolve(name, "index.html"), name + ".html"]) {
    if ((await stat(path).catch(() => null))?.isFile()) return path;
  }
  return null;
}
const server = createServer(async (req, res) => {
  const path = await localFile(req.url);
  if (!path) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.setHeader("Content-Type", types[extname(path)] || "text/plain");
  res.setHeader(
    "Content-Security-Policy",
    req.url.startsWith("/docs/")
      ? "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'"
      : "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'",
  );
  res.end(await readFile(path));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  await mkdir(".impeccable/review", { recursive: true });
  const pages = [
    "/",
    "/docs/",
    ...(await readdir("site-docs/guide"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => `/docs/guide/${file.slice(0, -3)}`),
    "/compare/",
    "/compare/openreplay.html",
  ];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    await page.addInitScript(() => localStorage.setItem("feedbacks-motion", "paused"));
    page.on("pageerror", (e) => failures.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    for (const path of pages) {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // Exercise lazy/offscreen loading before inspecting full-page artifacts.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        window.scrollTo(0, 0);
        await Promise.all(
          [...document.querySelectorAll("img[src]")]
            .filter((img) => img.getAttribute("src"))
            .map((img) => {
              img.loading = "eager";
              return img.decode().catch(() => {});
            }),
        );
      });
      assert.equal(await page.locator("h1").count(), 1, path);
      if (path.startsWith("/docs/")) {
        const flow = page.getByRole("list", { name: "Workflow at a glance" });
        assert.equal(await flow.count(), 1, path);
        assert.ok((await flow.locator("li").count()) >= 3, path);
        const markdown = await readFile(
          await localFile(path.replace(/\/$/, "/index") + ".md"),
          "utf8",
        );
        assert.ok(
          !markdown.includes("<DocPath"),
          "Agent Markdown includes readable steps",
        );
        assert.match(markdown, /1\. .+\n2\. /);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      if (overflow > 1) failures.push(`${path} at ${width}: overflow ${overflow}`);
      const broken = await page
        .locator("img")
        .evaluateAll((imgs) =>
          imgs
            .filter((i) => i.getAttribute("src") && (!i.complete || i.naturalWidth === 0))
            .map((i) => i.src),
        );
      failures.push(...broken.map((src) => `broken image: ${src}`));
      const links = await page
        .locator("a[href]")
        .evaluateAll((links) =>
          links
            .map((a) => a.getAttribute("href"))
            .filter((h) => h?.startsWith("/") && !h.startsWith("//")),
        );
      for (const link of new Set(links))
        if (!(await localFile(link))) failures.push(`broken link ${path} → ${link}`);
      const canonical = await page.locator("link[rel=canonical]").getAttribute("href");
      assert.ok(canonical.startsWith("https://feedbacks.softinator.ai/"), path);
      if (path.startsWith("/compare/")) {
        assert.equal(await page.getByRole("table").count(), 6);
        assert.equal(await page.locator(".matrix-scroll, .matrix-controls").count(), 0);
        for (const section of await page.locator(".compare-matrix").all()) {
          assert.equal(await section.locator("tr[data-tool]").count(), 16);
          assert.ok(
            await section.locator("table").evaluate((el) => {
              const style = getComputedStyle(el);
              const section = el.closest(".compare-matrix").getBoundingClientRect();
              const box = el.getBoundingClientRect();
              return (
                box.width >= section.width - 2 &&
                !["auto", "scroll"].includes(style.overflowY)
              );
            }),
            "Category table fills the section without a scrolling viewport",
          );
        }
        const evidence = page.locator(
          '#matrix-highlights tr[data-tool="feedbacks"] td[data-feature="apacheLicense"] summary',
        );
        assert.equal(await evidence.getAttribute("title"), "Checked 30 September 2026");
        assert.equal((await evidence.innerText()).trim(), "✓");
        await evidence.click();
        await page.locator("#evidence-popover").waitFor({ state: "visible" });
        assert.match(
          await page.locator(".evidence-content").innerText(),
          /30 September 2026/,
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => !document.querySelector('.matrix-evidence summary[aria-expanded="true"]'),
        );
        assert.ok(await evidence.evaluate((el) => el === document.activeElement));
        if (width <= 900) {
          const row = page.locator('#matrix-highlights tr[data-tool="pastel"]');
          const toggle = row.locator(".matrix-product-toggle");
          assert.equal(await toggle.getAttribute("aria-expanded"), "false");
          await toggle.focus();
          await page.keyboard.press("Enter");
          assert.equal(await toggle.getAttribute("aria-expanded"), "true");
          assert.ok(await row.locator('td[data-feature="apacheLicense"]').isVisible());
          await row.locator('td[data-feature="apacheLicense"] summary').click();
          await page.locator("#evidence-popover").waitFor({ state: "visible" });
          await page.keyboard.press("Escape");
          await toggle.click();
          assert.equal(await toggle.getAttribute("aria-expanded"), "false");
          if (path.endsWith("openreplay.html"))
            assert.equal(
              await page
                .locator(
                  '#matrix-highlights tr[data-tool="openreplay"] .matrix-product-toggle',
                )
                .getAttribute("aria-expanded"),
              "true",
            );
        }
        await page.locator('.matrix-jump a[href="#matrix-recording"]').click();
        assert.ok(
          await page.evaluate(() => scrollY > 500),
          "Category links use normal page scrolling",
        );
        await page.evaluate(() => scrollTo(0, 0));
      }
      if (path === "/docs/") {
        assert.equal(await page.locator("feedbacks-demo").count(), 1);
        assert.ok(
          await page
            .locator("feedbacks-demo")
            .getByRole("button", { name: "Play capture walkthrough", exact: true })
            .isVisible(),
        );
      }
      if (path === "/docs/guide/session-replay") {
        assert.equal(
          await page.locator('feedbacks-demo[step="recording"] .play').count(),
          1,
          "Docs hydration must preserve the interactive example",
        );
      }
      if (path === "/") {
        for (const link of await page.locator("a[href]").all()) {
          const href = await link.getAttribute("href");
          if (href.startsWith("#") || href === "/") continue;
          assert.equal(
            await link.getAttribute("target"),
            "_blank",
            `${href}: landing destinations open a new tab`,
          );
          assert.match(
            await link.getAttribute("rel"),
            /noopener/,
            `${href}: isolate the new tab`,
          );
        }
        assert.equal(
          await page.locator(".product-figure figcaption, .demo-guide").count(),
          0,
        );
        assert.equal(await page.locator("feedbacks-demo[depth]").count(), 2);
        assert.equal(
          await page.locator("#recordings feedbacks-demo").getAttribute("depth"),
          null,
          "Thread handoff remains flat",
        );
        assert.equal(
          await page.getByText("Team already has a setup?", { exact: true }).count(),
          1,
        );
        assert.equal(
          await page.locator(".existing-team-action a").getAttribute("href"),
          "https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo",
        );
        for (const arrow of await page
          .locator(".text-link > span, .story-note .link-arrow")
          .all()) {
          assert.equal(
            await arrow.evaluate(
              (el) => getComputedStyle(el.parentElement).textDecorationLine,
            ),
            "none",
            "Guide arrows do not inherit underlines",
          );
        }
        assert.deepEqual(
          await page
            .locator("main > section")
            .evaluateAll((sections) =>
              sections
                .slice(0, 3)
                .map((section) => section.getAttribute("aria-labelledby")),
            ),
          ["hero-title", "capture-title", "recordings-title"],
          "Show point capture immediately after the hero, then team discussion",
        );
        const demo = page.locator('feedbacks-demo[step="recording"]').first();
        assert.equal(
          (await page.locator("body").innerText()).match(/Apache-2.0/g)?.length,
          1,
          "State licensing once on the landing",
        );
        await demo.locator(".recording-inspector .review-follow").waitFor();
        assert.equal(await demo.locator(".caption").isVisible(), false);
        assert.equal(await demo.locator(".play").innerText(), "Play");
        assert.equal(
          await page.locator('a[href$=".webp"]').count(),
          0,
          "Playback stays on the page",
        );
        assert.equal(await demo.locator(".zoom, dialog").count(), 0);
        assert.ok(await demo.locator(".recording-inspector").isVisible());
        await demo
          .getByRole("button", { name: "0:04 · Request fails", exact: true })
          .click();
        assert.match(
          await demo.locator(".review-event[aria-current=true]").innerText(),
          /POST.*503/,
        );
        await demo
          .getByRole("button", { name: "0:05 · Console error", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        assert.match(
          await demo.locator(".review-event[aria-current=true]").innerText(),
          /Unable to place order/,
        );
        assert.ok(
          await demo.locator(".review-event[aria-current=true]").evaluate((row) => {
            const list = row.closest(".review-events").getBoundingClientRect(),
              box = row.getBoundingClientRect();
            return box.top >= list.top - 1 && box.bottom <= list.bottom + 1;
          }),
          "Seeking a moment brings its event into view",
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `.impeccable/review/hero-${width}.png` });
        const discussion = page.locator("#recordings feedbacks-demo");
        await discussion.scrollIntoViewIfNeeded();
        assert.equal(await discussion.getAttribute("step"), "discussion");
        assert.equal(await page.locator('feedbacks-demo[step="recording"]').count(), 1);
        await discussion
          .getByRole("button", {
            name: "Paste",
            exact: true,
          })
          .click();
        assert.ok(await discussion.locator(".handoff-paste").isVisible());
        assert.ok(await discussion.locator(".handoff-ready").isVisible());
        await discussion.locator(".play").click();
        await page.waitForTimeout(500);
        assert.equal(await discussion.locator(".play").innerText(), "Pause");
        await discussion.locator(".play").click();
        assert.equal(await discussion.locator(".play").innerText(), "Play");
      }
      if (path === "/compare/")
        await page.screenshot({ path: `.impeccable/review/matrix-${width}.png` });
      if (
        [
          "/docs/",
          "/docs/guide/mcp",
          "/docs/guide/github",
          "/docs/guide/session-replay",
          "/compare/openreplay.html",
        ].includes(path)
      )
        await page.screenshot({
          path: `.impeccable/review/${path.includes("docs") ? "docs-" + (path.split("/").filter(Boolean).at(-1) === "docs" ? "index" : path.split("/").at(-1)) : "compare"}-${width}.png`,
          fullPage: true,
        });
    }
    await page.close();
  }
  const nojs = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  await nojs.goto(origin);
  assert.match(await nojs.locator("main").innerText(), /Apache-2.0/);
  assert.equal(await nojs.locator('feedbacks-demo[step="recording"] img').count(), 1);
  assert.equal(await nojs.locator('feedbacks-demo[step="discussion"] img').count(), 1);
  assert.ok(await nojs.locator("#recordings").isVisible());
  await nojs.goto(origin + "/docs/");
  assert.ok(await nojs.getByRole("list", { name: "Workflow at a glance" }).isVisible());
  assert.ok(
    await nojs.locator("feedbacks-demo img").isVisible(),
    "Actual capture remains without JavaScript",
  );
  await nojs.goto(origin + "/docs/guide/review-feedback");
  const help = nojs.locator(".vp-doc details").first();
  await help.locator("summary").focus();
  await nojs.keyboard.press("Enter");
  assert.ok(
    await help.evaluate((el) => el.open),
    "Deep guidance opens from the keyboard without JavaScript",
  );
  await nojs.goto(origin + "/compare/");
  const fallback = nojs.locator(
    '#matrix-highlights tr[data-tool="feedbacks"] td[data-feature="apacheLicense"] details',
  );
  await fallback.locator("summary").click();
  assert.ok(
    await fallback.evaluate((el) => el.open),
    "Comparison evidence works without JavaScript",
  );
  assert.match(await fallback.innerText(), /30 September 2026/);
  assert.ok(await fallback.getByRole("link", { name: /Read source/ }).isVisible());
  await nojs.close();
  const dark = await browser.newPage({
    viewport: { width: 390, height: 900 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  for (const path of [
    "/docs/guide/mcp",
    "/docs/guide/session-replay",
    "/docs/guide/access-privacy",
  ]) {
    await dark.goto(origin + path, { waitUntil: "networkidle" });
    assert.ok(await dark.locator("html").evaluate((el) => el.classList.contains("dark")));
    assert.ok(
      await dark.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    );
  }
  await dark.screenshot({ path: ".impeccable/review/docs-dark-390.png", fullPage: true });
  await dark.close();
  for (const width of [320, 768, 1024]) {
    const narrow = await browser.newPage({ viewport: { width, height: 900 } });
    await narrow.goto(origin + "/compare/bugherd.html");
    assert.ok(
      await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    );
    const cell = narrow.locator(
      '#matrix-highlights tr[data-tool="bugherd"] td[data-feature="apacheLicense"] summary',
    );
    await cell.click();
    const box = await narrow.locator("#evidence-popover").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, "Evidence stays in viewport");
    await narrow.close();
  }
  assert.deepEqual([...new Set(failures)], []);
  console.log(
    `Public site browser QA passed: ${pages.length} routes at desktop/mobile, visual guide flows and Markdown, dark mode, keyboard/no-JavaScript disclosure, same-origin links/assets and recording playback.`,
  );
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
