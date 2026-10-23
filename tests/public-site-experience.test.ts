import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { configurePublicSiteExperience } from "../scripts/configure-site-experience.mjs";

const runtime = await readFile(new URL("../site/experience.js", import.meta.url), "utf8");
const stylesheet = await readFile(
  new URL("../site/experience.css", import.meta.url),
  "utf8",
);
const html =
  "<!doctype html><html><head><title>Public</title></head><body><main>Useful content</main></body></html>";

test("readiness postprocessing changes only public HTML and copies self-hosted assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedbacks-public-experience-"));
  try {
    for (const folder of ["site/docs/guide", "web", "extension"])
      await mkdir(join(root, folder), { recursive: true });
    const originals = new Map([
      [
        "site/_headers",
        "/*\n  Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'none'\n",
      ],
      ["site/docs/guide/start.md", "# Useful content\n"],
      ["site/deployment.json", '{"sha":"synthetic"}\n'],
      ["web/index.html", html],
      ["extension/popup.html", html],
    ]);
    for (const [name, value] of originals) await writeFile(join(root, name), value);
    for (const name of ["site/index.html", "site/docs/guide/start.html"])
      await writeFile(join(root, name), html);
    assert.deepEqual(await configurePublicSiteExperience(join(root, "site")), {
      pages: 2,
    });
    for (const name of ["site/index.html", "site/docs/guide/start.html"]) {
      const page = await readFile(join(root, name), "utf8");
      assert.equal(page.match(/id="site-thinking"/g)?.length, 1);
      assert.match(page, /role="status" aria-live="polite" aria-atomic="true" hidden/);
      assert.match(page, /Thinking…/);
      assert.equal(page.match(/href="\/site-experience.css"/g)?.length, 1);
      assert.equal(page.match(/src="\/site-experience.js"/g)?.length, 1);
      assert.match(
        page,
        /<script async data-cfasync="false" src="\/site-experience.js"><\/script>/,
      );
      assert.doesNotMatch(
        page,
        /<script[^>]+src="https?:|<style>|onload=|visibility:\s*hidden/,
      );
      assert.ok(page.includes("<main>Useful content</main>"));
    }
    assert.equal(await readFile(join(root, "site/site-experience.js"), "utf8"), runtime);
    assert.equal(
      await readFile(join(root, "site/site-experience.css"), "utf8"),
      stylesheet,
    );
    assert.doesNotMatch(
      runtime + stylesheet,
      /googletagmanager|google-analytics|site-analytics|feedbacks-public-analytics|Cookie preferences|Allow analytics/,
      "readiness introduces neither Google traffic nor consent controls",
    );
    for (const [name, value] of originals)
      assert.equal(
        await readFile(join(root, name), "utf8"),
        value,
        name + " remains unchanged",
      );
    assert.match(stylesheet, /pointer-events:\s*none/);
    assert.match(stylesheet, /\.site-thinking\[hidden\]\s*\{\s*display:\s*none/);
    assert.match(stylesheet, /prefers-reduced-motion:\s*reduce/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate or invalid public artifacts reject before any HTML is rewritten", async () => {
  for (const invalid of [
    "<html><body>Missing head</body></html>",
    "<html><head></head>No body</html>",
    html.replace("<main>", '<div id="site-thinking"></div><main>'),
  ]) {
    const root = await mkdtemp(join(tmpdir(), "feedbacks-invalid-experience-"));
    try {
      await writeFile(join(root, "a-valid.html"), html);
      await writeFile(join(root, "z-invalid.html"), invalid);
      await assert.rejects(
        configurePublicSiteExperience(root),
        /unconfigured public HTML/,
      );
      assert.equal(await readFile(join(root, "a-valid.html"), "utf8"), html);
      assert.equal(await readFile(join(root, "z-invalid.html"), "utf8"), invalid);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const root = await mkdtemp(join(tmpdir(), "feedbacks-duplicate-experience-"));
  try {
    await writeFile(join(root, "index.html"), html);
    await configurePublicSiteExperience(root);
    const configured = await readFile(join(root, "index.html"), "utf8");
    await assert.rejects(configurePublicSiteExperience(root), /unconfigured public HTML/);
    assert.equal(await readFile(join(root, "index.html"), "utf8"), configured);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class Hub {
  listeners = new Map<string, Set<Function>>();
  addEventListener(name: string, handler: Function, options: any = {}) {
    if (options.signal?.aborted) return;
    const listener = options.once
      ? (...args: any[]) => {
          this.removeEventListener(name, listener);
          handler(...args);
        }
      : handler;
    const handlers = this.listeners.get(name) ?? new Set();
    handlers.add(listener);
    this.listeners.set(name, handlers);
    options.signal?.addEventListener(
      "abort",
      () => this.removeEventListener(name, listener),
      { once: true },
    );
  }
  removeEventListener(name: string, handler: Function) {
    this.listeners.get(name)?.delete(handler);
  }
  fire(name: string, event: any = {}) {
    for (const handler of [...(this.listeners.get(name) ?? [])]) handler(event);
  }
}

class Element extends Hub {
  hidden = false;
  dataset: Record<string, string> = {};
  attributes = new Set<string>();
  box = { width: 100, height: 100, top: 20, bottom: 120, left: 0, right: 100 };
  getBoundingClientRect() {
    return this.box;
  }
  contains(node: unknown) {
    return node === this;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
}

function demoFixture({
  images = [] as any[],
  svgImages = [] as any[],
  children = 1,
} = {}) {
  const frame = { childElementCount: children };
  const stage = {
    hidden: true,
    querySelector: (selector: string) => (selector === ".frame" ? frame : null),
  };
  const demo = Object.assign(new Element(), {
    shadowRoot: {
      querySelector: (selector: string) => (selector === ".depth-stage" ? stage : null),
      querySelectorAll: (selector: string) =>
        selector === "img[src]" ? images : selector === "image[href]" ? svgImages : [],
    },
  });
  return { demo, frame, stage };
}

function browser({
  images = [] as any[],
  demos = [] as any[],
  animations = [] as any[],
  fonts = Promise.resolve(),
  imageFactory = () =>
    Object.assign(new Element(), { complete: true, decode: async () => {} }),
} = {}) {
  const indicator = new Element();
  indicator.hidden = true;
  const document = Object.assign(new Hub(), {
    hidden: false,
    readyState: "complete",
    fonts: { ready: fonts },
    getElementById: (id: string) => (id === "site-thinking" ? indicator : undefined),
    querySelectorAll: (selector: string) =>
      selector === "img[src]" ? images : selector === "feedbacks-demo" ? demos : [],
    getAnimations: () => animations,
  });
  const window: any = new Hub();
  const timers = new Map<number, { callback: Function; delay: number }>();
  let nextTimer = 0;
  const observers = new Set<any>();
  const definitions = new Map<string, unknown>();
  const waiting = new Map<string, ReturnType<typeof deferred>>();
  const context = {
    document,
    window,
    Element,
    Image: class {
      constructor() {
        return imageFactory();
      }
    },
    AbortController,
    URL,
    location: {
      href: "https://public.example.test/",
      origin: "https://public.example.test",
      pathname: "/",
      search: "",
    },
    innerHeight: 900,
    innerWidth: 1440,
    customElements: {
      get: (name: string) => definitions.get(name),
      whenDefined(name: string) {
        if (definitions.has(name)) return Promise.resolve();
        if (!waiting.has(name)) waiting.set(name, deferred());
        return waiting.get(name)!.promise;
      },
    },
    MutationObserver: class {
      constructor(public callback: Function) {}
      observe() {
        observers.add(this);
      }
      disconnect() {
        observers.delete(this);
      }
    },
    requestAnimationFrame: (callback: Function) => {
      queueMicrotask(() => callback(0));
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout: (callback: Function, delay: number) => {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearTimeout: (timer: number) => timers.delete(timer),
  };
  const execute = () => runInNewContext(runtime, context);
  const defineDemo = () => {
    definitions.set("feedbacks-demo", class {});
    waiting.get("feedbacks-demo")?.resolve();
  };
  const notify = () => {
    for (const observer of observers) observer.callback([]);
  };
  const flush = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  };
  return {
    context,
    indicator,
    document,
    window,
    timers,
    observers,
    execute,
    defineDemo,
    notify,
    flush,
  };
}

test("Thinking waits for visible assets, first demo frame and finite entrance animation", async () => {
  const font = deferred(),
    entrance = deferred();
  const image = Object.assign(new Element(), { complete: false, decode: async () => {} });
  const offscreen = Object.assign(new Element(), {
    complete: false,
    decode: () => {
      throw Error("offscreen image must not gate readiness");
    },
  });
  offscreen.box = { ...offscreen.box, top: 2000, bottom: 2100 };
  const { stage, demo } = demoFixture();
  const target = new Element();
  const page = browser({
    images: [image, offscreen],
    demos: [demo],
    fonts: font.promise,
    animations: [
      {
        effect: { target, getComputedTiming: () => ({ endTime: 350 }) },
        finished: entrance.promise,
      },
      {
        effect: { target, getComputedTiming: () => ({ endTime: Infinity }) },
        finished: new Promise(() => {}),
      },
      {
        effect: { target: offscreen, getComputedTiming: () => ({ endTime: 500 }) },
        finished: new Promise(() => {}),
      },
    ],
  });
  page.defineDemo();
  page.execute();
  await page.flush();
  assert.equal(page.indicator.hidden, false);
  font.resolve();
  await page.flush();
  assert.equal(page.indicator.hidden, false);
  image.complete = true;
  image.fire("load");
  await page.flush();
  assert.equal(
    page.indicator.hidden,
    false,
    "a decoded image cannot hide an unready first frame",
  );
  stage.hidden = false;
  page.notify();
  await page.flush();
  assert.equal(page.indicator.hidden, false, "finite entrance is still settling");
  entrance.resolve();
  await page.flush();
  assert.equal(page.indicator.hidden, true);
  assert.equal(page.indicator.dataset.state, "ready");
  assert.equal(page.timers.size, 0);
  assert.equal(page.observers.size, 0);
});

test("a visible late custom-element definition does not finish before its first frame", async () => {
  const { stage, demo } = demoFixture();
  const page = browser({ demos: [demo] });
  page.execute();
  await page.flush();
  assert.equal(
    page.indicator.hidden,
    false,
    "async definition is part of first-frame readiness",
  );
  page.defineDemo();
  await page.flush();
  assert.equal(page.indicator.hidden, false);
  stage.hidden = false;
  page.notify();
  await page.flush();
  assert.equal(page.indicator.hidden, true);
});

test("an unhidden demo waits for a populated first frame and decoded shadow images", async () => {
  for (const kind of ["img", "svg"]) {
    const decode = deferred();
    const image = Object.assign(new Element(), {
      complete: false,
      src: "",
      decode: () => decode.promise,
    });
    const { stage, frame, demo } = demoFixture({
      children: 0,
      images: kind === "img" ? [image] : [],
      svgImages:
        kind === "svg" ? [{ getAttribute: () => "/synthetic-first-frame.svg" }] : [],
    });
    const page = browser({ demos: [demo], imageFactory: () => image });
    page.defineDemo();
    page.execute();
    await page.flush();
    stage.hidden = false;
    page.notify();
    await page.flush();
    assert.equal(page.indicator.hidden, false, kind + " first frame is empty");
    frame.childElementCount = 1;
    page.notify();
    await page.flush();
    assert.equal(page.indicator.hidden, false, kind + " first image is loading");
    if (kind === "svg") assert.equal(image.src, "/synthetic-first-frame.svg");
    image.complete = true;
    image.fire("load");
    await page.flush();
    assert.equal(page.indicator.hidden, false, kind + " decode is still pending");
    decode.resolve();
    await page.flush();
    assert.equal(page.indicator.hidden, true);
    assert.equal(page.indicator.dataset.state, "ready");
    assert.equal(page.observers.size, 0);
    assert.equal(page.timers.size, 0);
    assert.equal(image.listeners.get("load")?.size, 0);
    assert.equal(image.listeners.get("error")?.size, 0);
  }
});

test("failed visible images and demos settle; offscreen and endless work do not block", async () => {
  const image = Object.assign(new Element(), {
    complete: false,
    decode: async () => {
      throw Error("synthetic decode failure");
    },
  });
  const demo = Object.assign(new Element(), {
    shadowRoot: { querySelector: () => undefined },
  });
  const page = browser({ images: [image], demos: [demo] });
  page.defineDemo();
  page.execute();
  await page.flush();
  image.complete = true;
  image.fire("error");
  demo.attributes.add("data-load-failed");
  page.notify();
  await page.flush();
  assert.equal(page.indicator.hidden, true);
  assert.equal(page.observers.size, 0);
});

test("route gates, deadline, superseded cycles and pagehide cannot leave stale Thinking", async () => {
  const page = browser();
  page.execute();
  await page.flush();
  assert.equal(page.indicator.hidden, true);
  const pending = deferred();
  page.document.fonts.ready = pending.promise;
  page.window.fire("feedbacks:route-start");
  await page.flush();
  assert.equal(
    page.indicator.hidden,
    false,
    "pending SPA chunk starts readiness without preparing the old page",
  );
  page.window.fire("feedbacks:route-ready");
  await page.flush();
  page.window.fire("feedbacks:route-start");
  await page.flush();
  pending.resolve();
  await page.flush();
  assert.equal(
    page.indicator.hidden,
    false,
    "an older route cannot finish a replacement cycle",
  );
  const deadline = [...page.timers.values()].find((timer) => timer.delay === 20_000);
  assert.ok(deadline, "hung route has an unchanged 20 second bound");
  deadline.callback();
  await page.flush();
  assert.equal(page.indicator.hidden, true);
  assert.equal(page.indicator.dataset.state, "degraded");
  page.window.fire("feedbacks:route-start");
  page.window.fire("pagehide");
  await page.flush();
  assert.equal(page.indicator.hidden, true);
  assert.equal(page.timers.size, 0);
  page.window.fire("pageshow", { persisted: true });
  await page.flush();
  assert.equal(page.indicator.hidden, true, "restored pages recheck and settle");
  const listenerCount = page.window.listeners.get("feedbacks:route-start")?.size;
  page.execute();
  assert.equal(page.window.listeners.get("feedbacks:route-start")?.size, listenerCount);
});

test("pagehide aborts pending image listeners and custom-frame observers", async () => {
  const image = Object.assign(new Element(), {
    complete: false,
    decode: async () => {},
  });
  const { stage, demo } = demoFixture();
  const page = browser({ images: [image], demos: [demo] });
  page.defineDemo();
  page.execute();
  await page.flush();
  assert.equal(page.observers.size, 1);
  assert.equal(image.listeners.get("load")?.size, 1);
  page.window.fire("pagehide");
  await page.flush();
  assert.equal(page.indicator.hidden, true);
  assert.equal(page.observers.size, 0);
  assert.equal(page.timers.size, 0);
  assert.equal(image.listeners.get("load")?.size, 0);
  assert.equal(image.listeners.get("error")?.size, 0);
  image.complete = true;
  image.fire("load");
  stage.hidden = false;
  page.notify();
  await page.flush();
  assert.equal(page.indicator.dataset.state, "cancelled");
  page.window.fire("pageshow", { persisted: true });
  await page.flush();
  assert.equal(page.indicator.dataset.state, "ready");
});

test("explicit router cancellation removes pending Thinking and its deadline", async () => {
  const page = browser();
  page.execute();
  await page.flush();
  page.window.fire("feedbacks:route-start");
  assert.equal(page.indicator.hidden, false);
  page.window.fire("feedbacks:route-cancel");
  await page.flush();
  assert.equal(page.indicator.hidden, true);
  assert.equal(page.indicator.dataset.state, "cancelled");
  assert.equal(page.timers.size, 0);
  page.window.fire("feedbacks:route-start");
  page.window.fire("feedbacks:route-ready");
  await page.flush();
  assert.equal(page.indicator.dataset.state, "ready");
});

test("only ordinary same-origin document navigation starts the native intent indicator", async () => {
  const page = browser();
  page.execute();
  await page.flush();
  const click = (options: any = {}) => {
    const link = {
      href: "https://public.example.test/next",
      target: "",
      hasAttribute: () => false,
      ...options.link,
    };
    page.document.fire("click", {
      button: 0,
      target: {
        closest: (selector: string) =>
          selector === "a[href]" || (selector === ".vp-raw" && options.nativeDocs)
            ? link
            : null,
      },
      ...options.event,
    });
  };
  for (const options of [
    { event: { ctrlKey: true } },
    { event: { metaKey: true } },
    { event: { shiftKey: true } },
    { event: { altKey: true } },
    { event: { button: 1 } },
    { event: { defaultPrevented: true } },
    { link: { href: "https://external.example.test/next" } },
    { link: { href: "https://public.example.test/#section" } },
    { link: { target: "_blank" } },
    { link: { hasAttribute: () => true } },
  ]) {
    click(options);
    assert.equal(page.indicator.hidden, true);
  }
  click();
  assert.equal(page.indicator.hidden, false);
  page.window.fire("pagehide");
  assert.equal(page.indicator.hidden, true);
  page.context.location.pathname = "/docs/guide/start";
  click();
  assert.equal(page.indicator.hidden, true, "VitePress owns its route events");
  click({ nativeDocs: true, link: { href: "https://public.example.test/privacy.html" } });
  assert.equal(page.indicator.hidden, false, "native docs footer links start readiness");
  page.window.fire("pagehide");
  assert.equal(page.indicator.hidden, true);
});
