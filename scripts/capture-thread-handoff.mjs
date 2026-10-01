import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";

// Real application captures, using disposable local members and discussion only.
const sandbox = spawn(process.execPath, ["scripts/dev-sandbox.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  const accessPath = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Sandbox startup timed out")), 30000);
    sandbox.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Local access file: ([^\r\n]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    sandbox.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Sandbox exited"));
    });
  });
  const access = JSON.parse(await readFile(accessPath, "utf8"));
  const post = async (operation, input, auth = {}) => {
    const response = await fetch(`${access.url}/api/${operation}`, {
      method: "POST",
      headers: {
        Origin: access.url,
        "Content-Type": "application/json",
        ...auth.headers,
      },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(`${operation}: ${result.error?.message}`);
    return {
      data: result.data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const login = async (email) => {
    const result = await post("auth.login", { email, password: access.password });
    return { headers: { Cookie: result.cookie, "X-CSRF-Token": result.data.csrf } };
  };
  const owner = await login(access.email);
  const project = (await post("projects.get", { projectId: access.projectId }, owner))
    .data;
  await post(
    "projects.update",
    {
      projectId: project.id,
      revision: project.revision,
      name: "Good Form",
      origins: project.origins,
    },
    owner,
  );
  for (const name of ["Maya", "Leo"]) {
    await post(
      "members.create",
      {
        name,
        email: `${name.toLowerCase()}@example.test`,
        password: access.password,
        grants: [{ projectId: project.id, role: "maintainer" }],
      },
      owner,
    );
  }
  const maya = await login("maya@example.test"),
    leo = await login("leo@example.test");
  let thread = (
    await post(
      "threads.create",
      {
        projectId: project.id,
        body: "Checkout fails after clicking Place order.",
        context: {
          url: "https://example.com/checkout",
          viewport: { width: 1280, height: 800 },
        },
        idempotencyKey: "public-thread-handoff",
      },
      maya,
    )
  ).data;
  thread = (
    await post(
      "threads.reply",
      {
        threadId: thread.id,
        revision: thread.revision,
        body: "Reproduced in Chrome. The cart stays saved.",
        idempotencyKey: "public-thread-reply-maya",
      },
      maya,
    )
  ).data;
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 850 },
    deviceScaleFactor: 2,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const cookie = leo.headers.Cookie,
    equals = cookie.indexOf("=");
  await context.addCookies([
    { name: cookie.slice(0, equals), value: cookie.slice(equals + 1), url: access.url },
  ]);
  const page = await context.newPage();
  const capture = async (name) => {
    await page.goto(`${access.url}/threads/${thread.id}`);
    await page
      .getByRole("button", { name: "Copy task for agent", exact: true })
      .waitFor();
    await page
      .getByText("Reproduced in Chrome. The cart stays saved.", { exact: true })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (name === "thread-discuss")
      await page
        .getByPlaceholder("Write a reply… Use @ to mention someone.")
        .fill("I’ll fix the checkout request and verify it.");
    const heading = await page.locator(".thread-page-heading").boundingBox();
    const clip = { x: 24, y: Math.floor(heading.y) - 8, width: 1152, height: 590 };
    const copy = await page
      .getByRole("button", { name: "Copy task for agent", exact: true })
      .boundingBox();
    await sharp(await page.screenshot({ clip }))
      .webp({ quality: 85 })
      .toFile(`public/learn/${name}.webp`);
    console.log(
      JSON.stringify({
        name,
        size: [2304, 1180],
        copy: [
          (copy.x + copy.width / 2 - clip.x) * 2,
          (copy.y + copy.height / 2 - clip.y) * 2,
        ],
      }),
    );
  };
  await capture("thread-discuss");
  await page
    .getByPlaceholder("Write a reply… Use @ to mention someone.")
    .fill("I’ll fix the checkout request and verify it.");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await page
    .getByText("I’ll fix the checkout request and verify it.", { exact: true })
    .waitFor();
  await capture("thread-ready");
  await page.getByRole("button", { name: "Copy task for agent", exact: true }).click();
  await page
    .getByText("Task copied. Paste it to review and discuss next steps.", {
      exact: true,
    })
    .waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (
    !copied.includes("Reproduced in Chrome") ||
    !copied.includes("I’ll fix the checkout request")
  )
    throw Error("Copied task lost discussion");
  console.log("Verified: actual Copy task for agent includes both team replies.");
} finally {
  await browser?.close();
  const stopped = once(sandbox, "exit");
  sandbox.kill("SIGTERM");
  await stopped;
}
