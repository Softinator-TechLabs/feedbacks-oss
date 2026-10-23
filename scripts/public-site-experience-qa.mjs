import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { configurePublicSiteExperience } from "./configure-site-experience.mjs";

// Run only after build:site. All requests remain on this disposable loopback
// server; analytics providers are blocked, never exercised by this fixture.
const root = resolve("dist/site");
const artifacts = resolve(".local/public-site-experience-qa");
const fixtureRoot = resolve(artifacts, "fixtures");
await mkdir(fixtureRoot, { recursive: true, mode: 0o700 });
const runtime = await readFile(resolve(root, "site-experience.js"), "utf8");
assert.equal(
  runtime,
  await readFile("site/experience.js", "utf8"),
  "build:site must include the current readiness runtime",
);
assert.equal(
  await readFile(resolve(root, "site-experience.css"), "utf8"),
  await readFile("site/experience.css", "utf8"),
);
for (const name of ["index.html", "docs/index.html"]) {
  const page = await readFile(resolve(root, name), "utf8");
  assert.equal(
    page.match(/id="site-thinking"/g)?.length,
    1,
    name + " has exactly one readiness status",
  );
  assert.match(page, /id="site-thinking"[^>]+hidden/);
}
let publicHTMLChecked = 0;
async function checkPublicArtifact(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await checkPublicArtifact(path);
    else if (entry.isFile() && entry.name.endsWith(".html")) {
      const html = await readFile(path, "utf8");
      assert.equal(html.match(/id="site-thinking"/g)?.length, 1, path);
      assert.doesNotMatch(
        html,
        /<(?:script|link)\b[^>]*(?:googletagmanager\.com|google-analytics\.com|site-analytics\.(?:js|css))|id=["']feedbacks-public-analytics["']/i,
        "public HTML no longer injects Google or its consent runtime",
      );
      publicHTMLChecked++;
    }
  }
}
await checkPublicArtifact(root);
for (const name of ["site-analytics.js", "site-analytics.css"])
  assert.equal(
    await stat(resolve(root, name)).catch(() => null),
    null,
    name + " is removed from the final public artifact",
  );
assert.doesNotMatch(
  await readFile(resolve(root, "_headers"), "utf8"),
  /googletagmanager|google-analytics|analytics\.google\.com|www\.google\.com/i,
  "Google origins are absent from final CSP",
);

const shell = (content) =>
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic readiness fixture</title><link rel="stylesheet" href="/__experience-fixture.css"></head><body><main><h1>Synthetic readiness fixture</h1><button id="content-action">Content remains usable</button><output id="content-result">0</output>' +
  content +
  '</main><footer><a href="/privacy.html">Privacy</a></footer><script defer src="/__experience-fixture.js"></script></body></html>';
const media =
  '<p class="font-gated">A visible delayed font.</p><img id="visible-image" src="/__experience-visible.svg" width="120" height="64" alt="Synthetic visible image"><feedbacks-demo></feedbacks-demo><p id="entrance">Finite entrance animation</p><div class="offscreen"><img src="/__experience-offscreen.svg" width="120" height="64" alt="Synthetic offscreen image"></div><script async src="/__experience-analytics-pending.js"></script>';
const links =
  '<a data-qa-link id="anchor-link" href="#section">Anchor</a><a data-qa-link id="external-link" href="https://external.example.test/">External</a><a data-qa-link id="blank-link" href="/next" target="_blank">New tab</a><a data-qa-link id="download-link" href="/next" download>Download</a><a data-qa-link id="next-link" href="/next">Next document</a>';
for (const [name, content] of [
  ["assets.html", media],
  ["empty.html", links],
  [
    "hung.html",
    '<img src="/__experience-hung.svg" width="120" height="64" alt="Synthetic hung image">',
  ],
])
  await writeFile(resolve(fixtureRoot, name), shell(content), { mode: 0o600 });
await configurePublicSiteExperience(fixtureRoot);
for (const name of [
  "assets.html",
  "empty.html",
  "hung.html",
  "site-experience.js",
  "site-experience.css",
])
  await chmod(resolve(fixtureRoot, name), 0o600);
const fixtureCSS =
  '@font-face{font-family:QaDelayed;src:url(/__experience-font.woff2) format("woff2");font-display:block}body{font-family:Arial,sans-serif;margin:24px;max-width:900px}main{min-height:70vh}button,a{margin:8px;padding:12px}output{display:block}.font-gated{font-family:QaDelayed,Arial,sans-serif}feedbacks-demo{display:block;width:240px;height:80px;margin:12px 0}.offscreen{margin-top:2000px}footer{padding:24px 0}';
const fixtureJS =
  'document.querySelector("#content-action").addEventListener("click",()=>document.querySelector("#content-result").textContent=String(Number(document.querySelector("#content-result").textContent)+1));window.addEventListener("click",event=>{if(event.target.closest?.("a[data-qa-link]"))event.preventDefault()});window.__qaDefineDemo=()=>{if(!customElements.get("feedbacks-demo"))customElements.define("feedbacks-demo",class extends HTMLElement{constructor(){super();this.attachShadow({mode:"open"}).innerHTML="<div class=depth-stage hidden><div class=frame></div></div>"}})};window.__qaRevealDemo=()=>{document.querySelector("feedbacks-demo").shadowRoot.querySelector(".depth-stage").hidden=false};window.__qaPopulateDemo=()=>{document.querySelector("feedbacks-demo").shadowRoot.querySelector(".frame").innerHTML=\'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="64"><image href="/__experience-shadow.svg" width="120" height="64"/></svg>\'};window.__qaStartEntrance=()=>{window.__qaEntrance=document.querySelector("#entrance").animate([{opacity:.3},{opacity:1}],{duration:30000,fill:"both"})};';
await writeFile(resolve(fixtureRoot, "fixture.css"), fixtureCSS, { mode: 0o600 });
await writeFile(resolve(fixtureRoot, "fixture.js"), fixtureJS, { mode: 0o600 });
const image = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="64"><rect width="120" height="64" fill="#c63f29"/></svg>',
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
async function localFile(base, pathname) {
  const name = resolve(base, "." + pathname);
  if (name !== base && !name.startsWith(base + sep)) return null;
  for (const file of [name, resolve(name, "index.html"), name + ".html"])
    if ((await stat(file).catch(() => null))?.isFile()) return file;
  return null;
}
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const fixture = pathname.startsWith("/__experience/");
    const file =
      pathname === "/__experience-fixture.css"
        ? resolve(fixtureRoot, "fixture.css")
        : pathname === "/__experience-fixture.js"
          ? resolve(fixtureRoot, "fixture.js")
          : pathname === "/__experience-font.woff2"
            ? resolve(root, "fonts/manrope-latin-v1.woff2")
            : await localFile(
                fixture ? fixtureRoot : root,
                fixture ? pathname.slice("/__experience".length) : pathname,
              );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      pathname.startsWith("/docs/")
        ? "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'"
        : "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'",
    );
    if (/^\/__experience-(visible|offscreen|hung|shadow)\.svg$/.test(pathname)) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(image);
      return;
    }
    if (pathname === "/__experience-analytics-pending.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end("/* Synthetic noncritical analytics delivery. */");
      return;
    }
    if (!file) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(500).end("Synthetic QA server error");
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true }).catch(async (error) => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  throw error;
});
const checks = [];
const outboundBlocked = new Set();
async function context(options = {}) {
  const value = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...options,
  });
  await value.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || !/^https?:$/.test(url.protocol)) return route.continue();
    outboundBlocked.add(url.hostname);
    return route.abort("blockedbyclient");
  });
  return value;
}
function gate() {
  let release, seen;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const requested = new Promise((resolve) => {
    seen = resolve;
  });
  return {
    release,
    requested,
    handler: async (route) => {
      seen();
      await pending;
      await route.continue().catch(() => {});
    },
  };
}
async function requested(...gates) {
  let timer;
  try {
    await Promise.race([
      Promise.all(gates.map((gate) => gate.requested)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Expected synthetic readiness request was not dispatched")),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function visible(page) {
  await page.locator("#site-thinking").waitFor({ state: "visible", timeout: 3000 });
}
async function ready(page, outcome = "ready") {
  await page.locator("#site-thinking").waitFor({ state: "hidden", timeout: 22_000 });
  assert.equal(await page.locator("#site-thinking").getAttribute("data-state"), outcome);
}
async function usable(page) {
  assert.equal(
    await page
      .locator("#site-thinking")
      .evaluate((node) => getComputedStyle(node).pointerEvents),
    "none",
  );
  await page.locator("#content-action").click();
  assert.equal(await page.locator("#content-result").textContent(), "1");
}
async function screenshot(page, name) {
  const path = resolve(artifacts, name + ".png");
  await page.screenshot({ path, fullPage: false });
  await chmod(path, 0o600);
}
async function check(name, work) {
  const started = Date.now();
  await work();
  checks.push({ name, passed: true, elapsedMs: Date.now() - started });
}
let failure;
try {
  for (const width of [1440, 390])
    await check("visible readiness gates " + width, async () => {
      const value = await context({
        viewport: { width, height: 900 },
        reducedMotion: width === 390 ? "reduce" : "no-preference",
      });
      const page = await value.newPage();
      const font = gate(),
        picture = gate(),
        shadow = gate(),
        offscreen = gate(),
        analytics = gate();
      try {
        await page.route("**/__experience-font.woff2", font.handler);
        await page.route("**/__experience-visible.svg", picture.handler);
        await page.route("**/__experience-shadow.svg", shadow.handler);
        await page.route("**/__experience-offscreen.svg", offscreen.handler);
        await page.route("**/__experience-analytics-pending.js", analytics.handler);
        await page.goto(origin + "/__experience/assets.html", {
          waitUntil: "domcontentloaded",
        });
        await requested(font, picture, offscreen, analytics);
        await visible(page);
        await usable(page);
        await page.evaluate(() => window.__qaStartEntrance());
        if (width === 390)
          assert.equal(
            await page
              .locator(".site-thinking-line")
              .evaluate((node) => getComputedStyle(node, "::after").animationName),
            "none",
          );
        font.release();
        await page.evaluate(() => document.fonts.ready);
        await visible(page);
        // Playwright screenshots wait for fonts. Capture the visible signal
        // while the image/frame gates remain held, after testing the font gate.
        await page.waitForFunction(
          () =>
            getComputedStyle(document.querySelector("#site-thinking")).opacity === "1",
        );
        await screenshot(page, "thinking-" + width);
        picture.release();
        await page.locator("#visible-image").evaluate((image) => image.decode());
        await visible(page);
        await page.evaluate(() => window.__qaDefineDemo());
        await visible(page);
        await page.evaluate(() => window.__qaRevealDemo());
        await page.evaluate(() => window.__qaEntrance.finish());
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
            ),
        );
        await visible(page);
        await page.evaluate(() => window.__qaPopulateDemo());
        await requested(shadow);
        await visible(page);
        shadow.release();
        await ready(page);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
        // Both noncritical requests are still held: readiness is not network-idle.
        assert.equal(
          await page.locator(".offscreen img").evaluate((image) => image.complete),
          false,
        );
      } finally {
        font.release();
        picture.release();
        shadow.release();
        offscreen.release();
        analytics.release();
        await value.close();
      }
    });
  await check("asset errors settle without blocking content", async () => {
    const value = await context(),
      page = await value.newPage();
    try {
      await page.route("**/__experience-font.woff2", (route) => route.abort("failed"));
      await page.route("**/__experience-visible.svg", (route) => route.abort("failed"));
      await page.goto(origin + "/__experience/assets.html", {
        waitUntil: "domcontentloaded",
      });
      await visible(page);
      await usable(page);
      await page.evaluate(() => {
        window.__qaDefineDemo();
        document.querySelector("feedbacks-demo").setAttribute("data-load-failed", "");
      });
      await ready(page);
    } finally {
      await value.close();
    }
  });
  await check("native intent exclusions, pagehide and bfcache restoration", async () => {
    const value = await context(),
      page = await value.newPage();
    try {
      await page.goto(origin + "/__experience/empty.html", {
        waitUntil: "domcontentloaded",
      });
      await ready(page);
      for (const id of ["anchor-link", "external-link", "blank-link", "download-link"]) {
        await page.locator("#" + id).click();
        assert.equal(await page.locator("#site-thinking").isVisible(), false, id);
      }
      await page.locator("#next-link").click();
      await visible(page);
      await usable(page);
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
      );
      assert.equal(await page.locator("#site-thinking").isVisible(), false);
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
      );
      await ready(page);
      await page.evaluate(() => dispatchEvent(new Event("feedbacks:route-start")));
      await visible(page);
      await page.evaluate(() => dispatchEvent(new Event("feedbacks:route-cancel")));
      await ready(page, "cancelled");
    } finally {
      await value.close();
    }
  });
  await check("hung SPA readiness is bounded and a later route recovers", async () => {
    const value = await context(),
      page = await value.newPage();
    try {
      await page.clock.install();
      await page.goto(origin + "/__experience/empty.html", {
        waitUntil: "domcontentloaded",
      });
      await ready(page);
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await page.evaluate(() => dispatchEvent(new Event("feedbacks:route-start")));
      assert.equal(await page.locator("#site-thinking").isVisible(), true);
      await page.clock.fastForward(19_999);
      assert.equal(
        await page.locator("#site-thinking").isVisible(),
        true,
        "20 second route deadline is not shortened",
      );
      await page.clock.fastForward(1);
      await ready(page, "degraded");
      await page.evaluate(() => {
        dispatchEvent(new Event("feedbacks:route-start"));
        dispatchEvent(new Event("feedbacks:route-ready"));
      });
      await page.clock.runFor(100);
      await ready(page);
    } finally {
      await value.close();
    }
  });
  await check(
    "hung visible image falls back and late completion stays settled",
    async () => {
      const value = await context(),
        page = await value.newPage(),
        picture = gate();
      try {
        await page.clock.install();
        await page.route("**/__experience-hung.svg", picture.handler);
        await page.goto(origin + "/__experience/hung.html", {
          waitUntil: "domcontentloaded",
        });
        await requested(picture);
        await visible(page);
        await usable(page);
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
        await page.clock.fastForward(21_000);
        await ready(page, "degraded");
        picture.release();
        await page.locator("img").evaluate((image) => image.decode());
        await page.clock.runFor(100);
        assert.equal(await page.locator("#site-thinking").isVisible(), false);
        assert.equal(
          await page.locator("#site-thinking").getAttribute("data-state"),
          "degraded",
        );
      } finally {
        picture.release();
        await value.close();
      }
    },
  );
  for (const width of [1440, 390])
    await check("built public pages and footer " + width, async () => {
      const value = await context({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await value.newPage(),
        errors = [];
      await page.addInitScript(() => {
        window.__qaDocument = crypto.randomUUID();
      });
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        for (const path of ["/", "/docs/"]) {
          await page.goto(origin + path, { waitUntil: "domcontentloaded" });
          await ready(page);
          assert.equal(await page.locator("h1").count(), 1);
          assert.equal(await page.locator("h1").isVisible(), true);
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          );
          assert.ok(
            (await page.locator("footer a[href='/privacy.html']").count()) > 0,
            "privacy is in the ordinary footer",
          );
          assert.equal(
            await page
              .getByRole("button", {
                name: /^(?:Cookie preferences|Allow analytics|Decline|Analytics preferences)$/i,
              })
              .count(),
            0,
            "retired consent controls are absent, including floating and footer toggles",
          );
          await screenshot(page, (path === "/" ? "landing-" : "docs-") + width);
        }
        const docsDocument = await page.evaluate(() => window.__qaDocument);
        await page.locator("footer.doc-privacy-footer a[href='/privacy.html']").click();
        await page.waitForURL("**/privacy.html");
        await ready(page);
        assert.match(await page.locator("h1").textContent(), /privacy/i);
        assert.notEqual(
          await page.evaluate(() => window.__qaDocument),
          docsDocument,
          "docs Privacy uses a native document load instead of the VitePress 404 router",
        );
        assert.equal(await page.getByText("PAGE NOT FOUND", { exact: true }).count(), 0);
        assert.deepEqual(errors, []);
      } finally {
        await value.close();
      }
    });
  await check(
    "actual VitePress pending chunk, history, anchors and superseded navigation",
    async () => {
      for (const cancel of [false, true]) {
        const value = await context({ reducedMotion: "reduce" }),
          page = await value.newPage(),
          chunk = gate();
        try {
          await page.route("**/docs/assets/guide_getting-started.md.*.js", chunk.handler);
          await page.addInitScript(() => {
            window.__qaRouteEvents = [];
            for (const name of ["feedbacks:route-start", "feedbacks:route-ready"])
              addEventListener(name, () => window.__qaRouteEvents.push(name));
            window.__qaDocument = crypto.randomUUID();
          });
          await page.goto(origin + "/docs/", { waitUntil: "domcontentloaded" });
          await ready(page);
          const documentId = await page.evaluate(() => window.__qaDocument);
          const heading = await page.locator("h1").textContent();
          await page.locator('a[href="/docs/guide/getting-started"]').first().click();
          await requested(chunk);
          await visible(page);
          assert.equal(
            await page.locator("h1").textContent(),
            heading,
            "old content remains readable while the chunk is pending",
          );
          assert.ok(
            await page.evaluate(() =>
              window.__qaRouteEvents.includes("feedbacks:route-start"),
            ),
          );
          if (cancel) {
            await page.locator('a[href="/docs/guide/review-feedback"]').first().click();
            await page.waitForURL("**/docs/guide/review-feedback");
            await ready(page);
            chunk.release();
            await page.waitForTimeout(150);
            assert.ok(
              page.url().endsWith("/docs/guide/review-feedback"),
              "stale chunk cannot replace a newer completed route",
            );
          } else {
            chunk.release();
            await page.waitForURL("**/docs/guide/getting-started");
            await ready(page);
            const starts = await page.evaluate(
              () =>
                window.__qaRouteEvents.filter((name) => name.endsWith("start")).length,
            );
            await page.goBack();
            await page.waitForURL("**/docs/");
            await ready(page);
            await page.goForward();
            await page.waitForURL("**/docs/guide/getting-started");
            await ready(page);
            assert.equal(
              await page.evaluate(
                () =>
                  window.__qaRouteEvents.filter((name) => name.endsWith("start")).length,
              ),
              starts + 2,
              "Back and Forward each start their own readiness cycle",
            );
            const events = await page.evaluate(() => window.__qaRouteEvents.length);
            await page.locator(".header-anchor").first().click({ force: true });
            assert.equal(
              await page.evaluate(() => window.__qaRouteEvents.length),
              events,
              "same-page anchor movement does not start a page load",
            );
            assert.equal(await page.locator("#site-thinking").isVisible(), false);
          }
          assert.equal(
            await page.evaluate(() => window.__qaDocument),
            documentId,
            "exercise the SPA router, not a full reload",
          );
          assert.ok(
            await page.evaluate(() =>
              window.__qaRouteEvents.includes("feedbacks:route-ready"),
            ),
          );
        } finally {
          chunk.release();
          await value.close();
        }
      }
    },
  );
  await check(
    "JavaScript disabled retains content without a visible loader",
    async () => {
      const value = await context({ javaScriptEnabled: false }),
        page = await value.newPage();
      try {
        for (const path of ["/", "/docs/"]) {
          await page.goto(origin + path, { waitUntil: "domcontentloaded" });
          assert.equal(await page.locator("h1").count(), 1);
          assert.equal(await page.locator("h1").isVisible(), true);
          assert.equal(await page.locator("#site-thinking").isVisible(), false);
        }
      } finally {
        await value.close();
      }
    },
  );
} catch (error) {
  failure = { name: error.name, message: error.message };
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    resolve(artifacts, "receipt.json"),
    JSON.stringify(
      {
        status: failure ? "failed" : "passed",
        checks,
        failure,
        outboundProvidersBlocked: [...outboundBlocked],
        syntheticOnly: true,
        builtRuntimeVerified: true,
        publicHTMLChecked,
        googlePayloadAbsent: true,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await chmod(resolve(artifacts, "receipt.json"), 0o600);
}
console.log(
  "Public Thinking readiness: " +
    checks.length +
    " browser checks passed; desktop/mobile artifacts in " +
    artifacts,
);
