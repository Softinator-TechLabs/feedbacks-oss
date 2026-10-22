import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  configurePublicSiteAnalytics,
  publicSiteAnalyticsConfiguration,
} from "../scripts/configure-site-analytics.mjs";

const environment = {
  PUBLIC_SITE_GA_ID: "G-ABCDEFGHIJ",
  PUBLIC_SITE_GA_HOST: "public.example.test",
};
const runtime = await readFile(new URL("../site/analytics.js", import.meta.url), "utf8");
const headers = await readFile(
  new URL("../site/public/_headers", import.meta.url),
  "utf8",
);

test("public analytics is off by default and requires a valid paired ID/hostname", () => {
  assert.equal(publicSiteAnalyticsConfiguration({}), undefined);
  assert.equal(
    publicSiteAnalyticsConfiguration({ PUBLIC_SITE_GA_ID: "", PUBLIC_SITE_GA_HOST: "" }),
    undefined,
  );
  assert.deepEqual(publicSiteAnalyticsConfiguration(environment), {
    id: environment.PUBLIC_SITE_GA_ID,
    host: environment.PUBLIC_SITE_GA_HOST,
  });
  for (const id of [
    "",
    "UA-123456-1",
    "G-abc1234567",
    'G-ABCDEFGHIJ"><script>',
    " G-ABCDEFGHIJ",
  ])
    assert.throws(
      () => publicSiteAnalyticsConfiguration({ ...environment, PUBLIC_SITE_GA_ID: id }),
      /measurement ID/,
    );
  for (const host of [
    "",
    "https://public.example.test",
    "public.example.test:443",
    "*.example.test",
    "Public.example.test",
    "public.example.test/",
    "127.0.0.1",
    "localhost",
    "example.test\nscript-src *",
  ])
    assert.throws(
      () =>
        publicSiteAnalyticsConfiguration({ ...environment, PUBLIC_SITE_GA_HOST: host }),
      /hostname/,
    );
});

test("the final public artifact alone receives consent assets and the narrow enabled CSP", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedbacks-public-analytics-"));
  const site = join(root, "site");
  const html =
    "<!doctype html><html><head><title>Public</title></head><body>Page</body></html>";
  try {
    for (const name of ["site/docs/guide", "web", "extension"])
      await mkdir(join(root, name), { recursive: true });
    for (const name of [
      "site/index.html",
      "site/docs/guide/start.html",
      "web/index.html",
      "extension/popup.html",
    ])
      await writeFile(join(root, name), html);
    await writeFile(join(site, "_headers"), headers);
    await writeFile(join(site, "docs/guide/start.md"), "# Public Markdown\n");
    assert.deepEqual(await configurePublicSiteAnalytics(site, {}), {
      enabled: false,
      pages: 0,
    });
    assert.equal(await readFile(join(site, "index.html"), "utf8"), html);
    assert.equal(await readFile(join(site, "_headers"), "utf8"), headers);
    assert.deepEqual((await readdir(site)).sort(), ["_headers", "docs", "index.html"]);
    const configured = await configurePublicSiteAnalytics(site, environment);
    assert.equal(configured.pages, 2);
    for (const name of ["index.html", "docs/guide/start.html"]) {
      const page = await readFile(join(site, name), "utf8");
      assert.equal(page.match(/id="feedbacks-public-analytics"/g)?.length, 1);
      assert.match(page, /defer src="\/site-analytics.js"/);
      assert.match(page, /data-ga-host="public.example.test"/);
      assert.doesNotMatch(page, /<script[^>]+src="https:/);
    }
    const enabled = await readFile(join(site, "_headers"), "utf8");
    for (const line of enabled
      .split("\n")
      .filter((line) => line.includes("Content-Security-Policy:"))) {
      assert.match(
        line,
        /script-src 'self'(?: 'unsafe-inline')? https:\/\/www.googletagmanager.com/,
      );
      assert.match(line, /connect-src (?:'self' )?https:\/\/www.googletagmanager.com/);
      assert.match(line, /https:\/\/\*\.google-analytics.com/);
      const directives = new Map(
        line
          .replace(/^\s*Content-Security-Policy: /, "")
          .split(";")
          .map((directive) => {
            const [name, ...sources] = directive.trim().split(/\s+/);
            return [name, sources];
          }),
      );
      // Google's basic Analytics transport also collects on www.google.com.
      assert.ok(directives.get("connect-src")?.includes("https://www.google.com"));
      for (const name of ["script-src", "img-src", "frame-src"])
        assert.ok(!directives.get(name)?.includes("https://www.google.com"));
      assert.match(line, /frame-ancestors 'none'; form-action 'none'/);
      assert.doesNotMatch(
        line,
        /doubleclick|googleadservices|unsafe-eval|connect-src 'none'/,
      );
    }
    assert.equal(enabled.match(/Content-Security-Policy:/g)?.length, 5);
    assert.equal(await readFile(join(root, "web/index.html"), "utf8"), html);
    assert.equal(await readFile(join(root, "extension/popup.html"), "utf8"), html);
    assert.equal(
      await readFile(join(site, "docs/guide/start.md"), "utf8"),
      "# Public Markdown\n",
    );
    await assert.rejects(
      configurePublicSiteAnalytics(site, environment),
      /unconfigured public HTML/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class Element {
  children: Element[] = [];
  attributes: Record<string, string> = {};
  events: Record<string, Function> = {};
  hidden = false;
  textContent = "";
  className = "";
  src = "";
  focused = false;
  constructor(public tag: string) {}
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  addEventListener(name: string, handler: Function) {
    this.events[name] = handler;
  }
  focus() {
    this.focused = true;
  }
  click() {
    this.events.click?.();
  }
}

function browser({
  host = environment.PUBLIC_SITE_GA_HOST,
  protocol = "https:",
  storage = new Map<string, string>(),
  blockedStorage = false,
} = {}) {
  const listeners: Record<string, Function> = {};
  const cookies = new Map([
    ["_ga", "synthetic"],
    ["_ga_ABCDEFGHIJ", "synthetic-session"],
  ]);
  const document = {
    currentScript: {
      dataset: {
        gaId: environment.PUBLIC_SITE_GA_ID,
        gaHost: environment.PUBLIC_SITE_GA_HOST,
      },
    },
    body: new Element("body"),
    head: new Element("head"),
    createElement: (tag: string) => new Element(tag),
    get cookie() {
      return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(value: string) {
      if (value.includes("Max-Age=0")) cookies.delete(value.split("=")[0]);
    },
  };
  const window: Record<string, any> = {
    addEventListener: (name: string, handler: Function) => {
      listeners[name] = handler;
    },
  };
  const context = {
    document,
    window,
    location: {
      hostname: host,
      protocol,
      origin: `${protocol}//${host}`,
      pathname: "/docs/guide/start",
      search: "?private=synthetic",
    },
    localStorage: {
      getItem(key: string) {
        if (blockedStorage) throw Error("blocked");
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (blockedStorage) throw Error("blocked");
        storage.set(key, value);
      },
      removeItem(key: string) {
        if (blockedStorage) throw Error("blocked");
        storage.delete(key);
      },
    },
  };
  const execute = () => runInNewContext(runtime, context);
  execute();
  const elements = (node = document.body): Element[] => [
    node,
    ...node.children.flatMap((child) => elements(child)),
  ];
  const button = (name: string) =>
    elements().find((node) => node.tag === "button" && node.textContent === name)!;
  return { document, window, storage, cookies, listeners, execute, button };
}

test("another hostname, HTTP and duplicate loader execution cannot initialize tracking", () => {
  for (const settings of [
    { host: "team.example.test" },
    { host: "public.example.test.evil.test" },
    { protocol: "http:" },
  ]) {
    const page = browser(settings);
    assert.equal(page.document.body.children.length, 0);
    assert.equal(page.document.head.children.length, 0);
    assert.equal(page.window.dataLayer, undefined);
  }
  const page = browser();
  page.execute();
  assert.equal(page.document.body.children.length, 2);
});

test("no Google tag or queue exists before Allow; decline persists without tracking", () => {
  const page = browser();
  assert.equal(page.document.head.children.length, 0);
  assert.equal(page.window.dataLayer, undefined);
  assert.equal(page.window["ga-disable-G-ABCDEFGHIJ"], true);
  assert.equal(page.document.body.children[1].hidden, false);
  page.button("Decline").click();
  assert.equal(page.document.body.children[1].hidden, true);
  assert.equal(page.document.head.children.length, 0);
  const nextPage = browser({ storage: page.storage });
  assert.equal(nextPage.document.body.children[1].hidden, true);
  assert.equal(nextPage.document.head.children.length, 0);
});

test("Allow configures once without ads/manual pageviews; withdrawal disables and clears cookies", () => {
  const page = browser();
  page.button("Allow analytics").click();
  assert.equal(page.document.head.children.length, 1);
  assert.equal(
    page.document.head.children[0].src,
    "https://www.googletagmanager.com/gtag/js?id=G-ABCDEFGHIJ",
  );
  const commands = page.window.dataLayer.map((args: unknown[]) => Array.from(args));
  assert.equal(commands.length, 2);
  assert.equal(commands[1][0], "config");
  assert.equal(commands[1][1], environment.PUBLIC_SITE_GA_ID);
  assert.equal(commands[1][2].allow_google_signals, false);
  assert.equal(commands[1][2].allow_ad_personalization_signals, false);
  assert.equal(commands[1][2].cookie_domain, "none");
  assert.equal(commands[1][2].cookie_update, false);
  // Let the one automatic pageview/history mechanism resolve each current public
  // document. No fixed URL, query-derived title or account attributes are supplied.
  for (const key of ["page_location", "page_title", "user_id", "user_properties"])
    assert.equal(commands[1][2][key], undefined);
  assert.equal(page.window["ga-disable-G-ABCDEFGHIJ"], false);
  page.button("Cookie preferences").click();
  page.button("Allow analytics").click();
  assert.equal(page.document.head.children.length, 1);
  assert.equal(page.window.dataLayer.length, 2);
  page.cookies.set("_ga", "synthetic-after-allow");
  page.cookies.set("_ga_ABCDEFGHIJ", "synthetic-session-after-allow");
  page.button("Cookie preferences").click();
  page.button("Decline").click();
  assert.equal(page.window["ga-disable-G-ABCDEFGHIJ"], true);
  assert.equal(page.cookies.size, 0);
  assert.equal(page.window.dataLayer.length, 2); // No Google consent ping after withdrawal.
  const nextPage = browser({ storage: page.storage });
  assert.equal(nextPage.document.head.children.length, 0);
});

test("saved acceptance, expiry, blocked storage and cross-tab withdrawal are honored", () => {
  const key = "feedbacks-public-analytics-v1";
  const storage = new Map([
    [key, JSON.stringify({ allowed: true, updatedAt: Date.now() })],
  ]);
  const page = browser({ storage });
  assert.equal(page.document.head.children.length, 1);
  storage.set(key, JSON.stringify({ allowed: false, updatedAt: Date.now() }));
  page.listeners.storage({ key });
  assert.equal(page.window["ga-disable-G-ABCDEFGHIJ"], true);
  storage.set(key, JSON.stringify({ allowed: true, updatedAt: 1 }));
  const expired = browser({ storage });
  assert.equal(expired.document.head.children.length, 0);
  assert.equal(expired.document.body.children[1].hidden, false);
  assert.equal(storage.has(key), false);
  const blocked = browser({ blockedStorage: true });
  assert.equal(blocked.document.head.children.length, 0);
  blocked.button("Allow analytics").click();
  assert.equal(blocked.document.head.children.length, 1);
});
