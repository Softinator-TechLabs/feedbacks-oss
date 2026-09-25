import { readFile, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { publicAddress } from "../src/server/webhooks.js";
import { validateQaUrl } from "../src/server/scheduled-qa.js";

const MAX_RESOURCE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * MAX_RESOURCE_BYTES;

export function validateVisualTarget(rawUrl, approvedOrigin) {
  const origin = new URL(approvedOrigin);
  if (origin.origin !== approvedOrigin || origin.protocol !== "https:")
    throw Error("Approved origin must be an exact public HTTPS origin");
  return validateQaUrl(rawUrl, [approvedOrigin]);
}

export function allowedVisualRequest(rawUrl, method, approvedOrigin) {
  try {
    const url = new URL(rawUrl);
    return (
      method === "GET" &&
      url.protocol === "https:" &&
      url.origin === approvedOrigin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      rawUrl.length <= 2048
    );
  } catch {
    return false;
  }
}

async function fetchPinnedResource(url) {
  const target = new URL(url);
  let dnsTimer;
  const address = await Promise.race([
    publicAddress(target.hostname),
    new Promise(
      (_, reject) =>
        (dnsTimer = setTimeout(() => reject(Error("Visual QA DNS timeout")), 5000)),
    ),
  ]).finally(() => clearTimeout(dnsTimer));
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        timeout: 5000,
        headers: { "user-agent": "Feedbacks-Visual-QA/1", "accept-encoding": "identity" },
        lookup: (_host, _opts, callback) =>
          callback(null, address.address, address.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300 || res.headers["content-encoding"]) {
          res.destroy();
          reject(Error(`Visual QA resource returned HTTP ${status} or encoded bytes`));
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on("data", (part) => {
          bytes += part.length;
          if (bytes > MAX_RESOURCE_BYTES)
            req.destroy(Error("Visual QA resource exceeds 1 MiB"));
          else chunks.push(part);
        });
        res.on("end", () =>
          resolve({
            status,
            body: Buffer.concat(chunks),
            contentType: String(
              res.headers["content-type"] ?? "application/octet-stream",
            ),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(Error("Visual QA request timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function captureScreenshot({
  url,
  approvedOrigin,
  scripts = false,
  viewport = { width: 1280, height: 800 },
  fetchResource = fetchPinnedResource,
  launchOptions = {},
}) {
  const target = validateVisualTarget(url, approvedOrigin);
  if (typeof scripts !== "boolean") throw Error("Visual QA script mode must be boolean");
  if (
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width < 320 ||
    viewport.width > 1920 ||
    viewport.height < 320 ||
    viewport.height > 1200 ||
    viewport.width * viewport.height > 2_000_000
  )
    throw Error("Visual QA viewport is outside the allowed bounds");
  let requested = 0;
  let totalBytes = 0;
  let blocked = 0;
  let failed = 0;
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND"],
    ...launchOptions,
  });
  try {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
      javaScriptEnabled: scripts,
      acceptDownloads: false,
      permissions: [],
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    if (scripts)
      await context.addInitScript(() => {
        // Browser routing does not govern WebRTC's peer-to-peer transport.
        for (const name of [
          "RTCPeerConnection",
          "webkitRTCPeerConnection",
          "WebTransport",
        ])
          Object.defineProperty(globalThis, name, {
            value: undefined,
            configurable: false,
          });
      });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const browserRequest = route.request();
      if (
        !allowedVisualRequest(
          browserRequest.url(),
          browserRequest.method(),
          approvedOrigin,
        )
      ) {
        blocked++;
        await route.abort();
        return;
      }
      requested++;
      if (requested > 40) {
        await route.abort();
        return;
      }
      try {
        const response = await fetchResource(browserRequest.url());
        totalBytes += response.body.length;
        if (totalBytes > MAX_TOTAL_BYTES || response.body.length > MAX_RESOURCE_BYTES)
          throw Error("Visual QA resource budget exceeded");
        if (
          browserRequest.isNavigationRequest() &&
          !/^text\/html(?:;|$)/i.test(response.contentType)
        )
          throw Error("Visual QA page is not HTML");
        await route.fulfill({
          status: response.status,
          contentType: response.contentType,
          body: response.body,
        });
      } catch {
        failed++;
        await route.abort();
      }
    });
    const page = await context.newPage();
    context.on("page", (opened) => {
      if (opened !== page) void opened.close();
    });
    page.on("dialog", (dialog) => void dialog.dismiss());
    const response = await page.goto(target, {
      waitUntil: "load",
      timeout: 15_000,
    });
    if (page.url() !== target || response?.status() !== 200)
      throw Error("Visual QA navigation changed or did not return HTTP 200");
    if (page.url() !== target)
      throw Error("Visual QA page navigated away from the approved URL");
    if (failed || requested > 40)
      throw Error(
        "Visual QA could not load every approved page resource within the budget",
      );
    const image = await page.screenshot({
      type: "png",
      animations: "disabled",
      timeout: 5000,
    });
    await context.close();
    return {
      image,
      blockedRequests: blocked,
      resourceCount: requested,
      scriptsEnabled: scripts,
    };
  } finally {
    await browser.close();
  }
}

export async function compareScreenshots(baseline, candidate) {
  const [a, b] = await Promise.all([
    sharp(baseline, { limitInputPixels: 2_000_000 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(candidate, { limitInputPixels: 2_000_000 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height)
    throw Error("Screenshots need matching dimensions");
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (
      Math.abs(a.data[i] - b.data[i]) > 20 ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > 20 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 20 ||
      Math.abs(a.data[i + 3] - b.data[i + 3]) > 20
    )
      changed++;
  return {
    width: a.info.width,
    height: a.info.height,
    changedPercent: Math.round((changed / (a.info.width * a.info.height)) * 10_000) / 100,
  };
}

async function main() {
  const options = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const split = arg.indexOf("=");
      if (split < 3 || !arg.startsWith("--")) throw Error("Use --name=value options");
      return [arg.slice(2, split), arg.slice(split + 1)];
    }),
  );
  const names = Object.keys(options);
  if (
    names.some(
      (name) =>
        ![
          "url",
          "origin",
          "baseline",
          "output",
          "init-baseline",
          "width",
          "height",
          "max-change",
          "scripts",
        ].includes(name),
    )
  )
    throw Error("Unknown visual QA option");
  const init = options["init-baseline"] === "true";
  const scripts = options.scripts === "true";
  if (
    !options.url ||
    !options.origin ||
    !options.baseline ||
    !options.output ||
    (options["init-baseline"] && !init) ||
    (options.scripts && !scripts) ||
    options.baseline === options.output
  )
    throw Error(
      "Supply --url, --origin, separate --baseline and --output paths; use --init-baseline=true once",
    );
  const viewport = {
    width: Number(options.width ?? 1280),
    height: Number(options.height ?? 800),
  };
  const maxChange = Number(options["max-change"] ?? 0);
  if (!Number.isFinite(maxChange) || maxChange < 0 || maxChange > 100)
    throw Error("--max-change must be 0 through 100");
  const capture = await captureScreenshot({
    url: options.url,
    approvedOrigin: options.origin,
    scripts,
    viewport,
  });
  await writeFile(options.output, capture.image, { flag: "wx", mode: 0o600 });
  if (init) {
    await writeFile(options.baseline, capture.image, { flag: "wx", mode: 0o600 });
    process.stdout.write(
      JSON.stringify({ baselineCreated: true, ...capture, image: undefined }) + "\n",
    );
    return;
  }
  const comparison = await compareScreenshots(
    await readFile(options.baseline),
    capture.image,
  );
  process.stdout.write(
    JSON.stringify({
      ...comparison,
      blockedRequests: capture.blockedRequests,
      resourceCount: capture.resourceCount,
      scriptsEnabled: capture.scriptsEnabled,
    }) + "\n",
  );
  if (comparison.changedPercent > maxChange) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
