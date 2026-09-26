import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { compareScreenshots } from "./visual-qa.mjs";

const root = resolve(import.meta.dirname, "..");

export function validateSandboxOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("Only a disposable loopback sandbox is allowed");
  }
  if (
    url.origin !== value ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    Number(url.port) < 1 ||
    url.username ||
    url.password
  )
    throw Error("Only a disposable loopback sandbox is allowed");
  return value;
}

export function allowedAppRequest(rawUrl, method, sandboxOrigin) {
  try {
    validateSandboxOrigin(sandboxOrigin);
    const url = new URL(rawUrl);
    return url.origin === sandboxOrigin && ["GET", "POST"].includes(method);
  } catch {
    return false;
  }
}

async function startSandbox() {
  const child = spawn(process.execPath, ["scripts/dev-sandbox.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errorOutput = "";
  child.stderr.on("data", (data) => {
    errorOutput += String(data).slice(0, 2000);
  });
  const accessPath = await new Promise((resolvePath, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Synthetic app did not start")),
      30_000,
    );
    const finish = (error, path) => {
      clearTimeout(timeout);
      child.stdout.off("data", receive);
      child.off("exit", exited);
      if (error) reject(error);
      else resolvePath(path);
    };
    const receive = (data) => {
      output += String(data);
      const match = output.match(/Local access file: ([^\r\n]+)/);
      if (match) finish(null, match[1]);
      if (output.length > 4000) finish(Error("Unexpected synthetic app output"));
    };
    const exited = () =>
      finish(Error(`Synthetic app exited: ${errorOutput.slice(0, 300)}`));
    child.stdout.on("data", receive);
    child.once("exit", exited);
  }).catch((error) => {
    child.kill("SIGTERM");
    throw error;
  });
  const access = JSON.parse(await readFile(accessPath, "utf8"));
  validateSandboxOrigin(access.url);
  return { child, access };
}

export async function captureSyntheticApp({ launchOptions = {} } = {}) {
  const { child, access } = await startSandbox();
  let browser;
  try {
    const login = await fetch(`${access.url}/api/auth.login`, {
      method: "POST",
      headers: { Origin: access.url, "Content-Type": "application/json" },
      body: JSON.stringify({ email: access.email, password: access.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!login.ok) throw Error("Synthetic sign-in failed");
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw Error("Synthetic sign-in has no session cookie");
    const split = cookie.indexOf("=");
    browser = await chromium.launch({ headless: true, ...launchOptions });
    const images = {};
    let blockedRequests = 0;
    for (const [width, height, device] of [
      [1280, 800, "desktop"],
      [390, 844, "mobile"],
    ])
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width, height },
          serviceWorkers: "block",
          acceptDownloads: false,
          permissions: [],
          reducedMotion: "reduce",
        });
        try {
          await context.addCookies([
            {
              name: cookie.slice(0, split),
              value: cookie.slice(split + 1),
              url: access.url,
              httpOnly: true,
              sameSite: "Lax",
            },
          ]);
          await context.addInitScript((value) => {
            localStorage.setItem("feedbacks-theme", value);
          }, theme);
          await context.routeWebSocket("**/*", (socket) => socket.close());
          await context.route("**/*", async (route) => {
            const request = route.request();
            if (!allowedAppRequest(request.url(), request.method(), access.url)) {
              blockedRequests++;
              await route.abort();
            } else await route.continue();
          });
          const page = await context.newPage();
          context.on("page", (opened) => {
            if (opened !== page) void opened.close();
          });
          page.on("dialog", (dialog) => void dialog.dismiss());
          await page.goto(`${access.url}/projects/${access.projectId}`, {
            waitUntil: "load",
          });
          await page.getByRole("heading", { name: "Feedback" }).waitFor();
          const threadLink = page.locator('a[href^="/threads/"]').first();
          await threadLink.waitFor();
          const href = await threadLink.getAttribute("href");
          if (!href) throw Error("Synthetic feedback row is missing");
          await page.evaluate(() => scrollTo(0, 0));
          images[`queue-${device}-${theme}`] = await page.screenshot({
            type: "png",
            animations: "disabled",
          });
          await page.goto(`${access.url}${href}`, { waitUntil: "load" });
          await page.getByRole("heading", { name: /Feedback/ }).waitFor();
          await page.locator("#thread-github").waitFor();
          await page.evaluate(() => scrollTo(0, 0));
          images[`thread-${device}-${theme}`] = await page.screenshot({
            type: "png",
            animations: "disabled",
          });
          await page.goto(`${access.url}/projects/${access.projectId}/github`, {
            waitUntil: "load",
          });
          await page.getByRole("heading", { name: "GitHub", exact: true }).waitFor();
          await page.evaluate(() => scrollTo(0, 0));
          images[`github-${device}-${theme}`] = await page.screenshot({
            type: "png",
            animations: "disabled",
          });
          await page.goto(`${access.url}/help`, { waitUntil: "load" });
          await page.getByRole("heading", { name: "Find your guide" }).waitFor();
          await page.evaluate(() => scrollTo(0, 0));
          images[`help-${device}-${theme}`] = await page.screenshot({
            type: "png",
            animations: "disabled",
          });
          await context.close();
        } catch (error) {
          await context.close();
          throw error;
        }
      }
    return { images, blockedRequests };
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
  }
}

async function main() {
  const options = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const match = argument.match(/^--([a-z-]+)=(.*)$/);
      if (!match) throw Error("Use --name=value options");
      return [match[1], match[2]];
    }),
  );
  if (
    Object.keys(options).some(
      (key) =>
        !["baseline-dir", "output-dir", "init-baseline", "max-change"].includes(key),
    )
  )
    throw Error("Unknown app visual option");
  if (
    !options["baseline-dir"] ||
    !options["output-dir"] ||
    options["baseline-dir"] === options["output-dir"]
  )
    throw Error("Supply separate --baseline-dir and --output-dir");
  const init = options["init-baseline"] === "true";
  if (options["init-baseline"] && !init) throw Error("Use --init-baseline=true only");
  const maxChange = Number(options["max-change"] ?? 0.5);
  if (!Number.isFinite(maxChange) || maxChange < 0 || maxChange > 100)
    throw Error("--max-change must be 0 through 100");
  const { images, blockedRequests } = await captureSyntheticApp();
  await mkdir(options["output-dir"], { recursive: true });
  if (init) await mkdir(options["baseline-dir"], { recursive: true });
  let hasDifference = false;
  const results = {};
  for (const [name, image] of Object.entries(images)) {
    const path = `${options["output-dir"]}/${name}.png`;
    await writeFile(path, image, { flag: "wx", mode: 0o600 });
    const baseline = `${options["baseline-dir"]}/${name}.png`;
    if (init) {
      await writeFile(baseline, image, { flag: "wx", mode: 0o600 });
      results[name] = { baselineCreated: true };
    } else {
      const comparison = await compareScreenshots(await readFile(baseline), image);
      results[name] = comparison;
      if (comparison.changedPercent > maxChange) hasDifference = true;
    }
  }
  process.stdout.write(JSON.stringify({ results, blockedRequests }) + "\n");
  if (hasDifference) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
