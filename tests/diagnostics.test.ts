import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { diagnosticsSchema } from "../src/shared/diagnostics.js";
// @ts-expect-error The extension ships native JavaScript.
import {
  maskDraftDiagnostic,
  redactDiagnosticSelection,
} from "../extension/diagnostic-redaction.js";

test("console diagnostics can mask selected text without adding new content", () => {
  const original = "failed for customer reference 12345";
  const start = original.indexOf("customer");
  const result = redactDiagnosticSelection(original, start, original.length);
  assert.equal(result, "failed for [redacted]");
  assert.doesNotMatch(result, /12345/);
  assert.throws(() => redactDiagnosticSelection(original, -1, 5), /Select/);
  assert.throws(() => redactDiagnosticSelection(original, 5, 5), /Select/);
  assert.throws(() => redactDiagnosticSelection(original, 0, 401), /Select/);
  const draft = {
    id: "draft-1",
    diagnostics: {
      console: [{ level: "error", message: original, atMs: 2 }],
      network: [],
    },
  };
  const masked = maskDraftDiagnostic(draft, {
    id: "draft-1",
    index: 0,
    start,
    end: original.length,
  });
  assert.equal(masked.diagnostics.console[0].message, result);
  assert.equal(draft.diagnostics.console[0].message, original);
  assert.throws(
    () =>
      maskDraftDiagnostic(
        { ...draft, frozen: true },
        { id: "draft-1", index: 0, start, end: 10 },
      ),
    /no longer editable/,
  );
});

test("diagnostics need consent, reject extra payloads, strip URL credentials and bound entries", () => {
  const input = {
    approved: true,
    source: "browser_opt_in",
    startedAt: "2026-09-16T00:00:00.000Z",
    endedAt: "2026-09-16T00:01:00.000Z",
    console: [
      {
        level: "error",
        message:
          "request https://u:p@example.test/path?token=secret#frag Bearer credential password=secret user@example.test",
        atMs: 1,
      },
    ],
    network: [
      {
        url: "https://u:p@example.test/path?token=secret#frag",
        type: "fetch",
        status: null,
        durationMs: 50,
        atMs: 1,
      },
    ],
  };
  const out = diagnosticsSchema.parse(input);
  assert.equal(out.network[0].url, "https://example.test");
  assert.doesNotMatch(
    out.console[0].message,
    /secret|credential|user@example|u:p|#frag|\/path/,
  );
  assert.equal(out.trust, "untrusted_diagnostics");
  assert.equal(diagnosticsSchema.safeParse({ ...input, approved: false }).success, false);
  assert.equal(
    diagnosticsSchema.safeParse({ ...input, cookies: "private" }).success,
    false,
  );
  assert.equal(
    diagnosticsSchema.safeParse({
      ...input,
      network: [{ ...input.network[0], headers: { authorization: "private" } }],
    }).success,
    false,
  );
  assert.equal(
    diagnosticsSchema.safeParse({
      ...input,
      network: [{ ...input.network[0], url: "file:///etc/passwd" }],
    }).success,
    false,
  );
  assert.equal(
    diagnosticsSchema.safeParse({ ...input, console: Array(26).fill(input.console[0]) })
      .success,
    false,
  );
});

test("page recorder stays off until asked, preserves console behavior, caps capture and tears down", async () => {
  const handlers = new Map<string, Function>(),
    timers: Function[] = [],
    logged: any[] = [],
    observers: any[] = [];
  let now = 100;
  const original = (...args: any[]) => logged.push(args);
  const c = vm.createContext({
    URL,
    Date,
    performance: { now: () => now },
    console: { warn: original, error: original },
    setTimeout: (f: Function) => {
      timers.push(f);
      return 1;
    },
    clearTimeout() {},
    window: {
      addEventListener: (name: string, f: Function) => handlers.set(name, f),
      removeEventListener: (name: string, f: Function) => {
        if (handlers.get(name) === f) handlers.delete(name);
      },
    },
    PerformanceObserver: class {
      callback: Function;
      disconnected = false;
      constructor(f: Function) {
        this.callback = f;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  });
  vm.runInContext(
    (
      await readFile(new URL("../extension/diagnostics.js", import.meta.url), "utf8")
    ).replace(/^export /gm, ""),
    c,
  );
  const run = (code: string) => vm.runInContext(code, c);
  assert.equal(run('diagnosticCollector("take","review")'), null);
  assert.equal(observers.length, 0);
  run('diagnosticCollector("start","review")');
  now = 200;
  for (let n = 0; n < 30; n++)
    run(
      'console.error("token=private https://u:p@example.test/a?key=private#f", {password:"never-read"})',
    );
  assert.equal(logged.length, 30);
  assert.equal(logged[0][1].password, "never-read");
  observers[0].callback({
    getEntries: () =>
      Array(55).fill({
        startTime: 150,
        name: "https://u:p@example.test/a?key=private#f",
        initiatorType: "fetch",
        duration: 40,
        responseStatus: 0,
      }),
  });
  const out = JSON.parse(
    JSON.stringify(run('cleanDiagnostics(diagnosticCollector("take","review"))')),
  );
  assert.equal(out.console.length, 25);
  assert.equal(out.network.length, 50);
  assert.doesNotMatch(JSON.stringify(out), /private|never-read|u:p|\?key|#f|\/a/);
  assert.equal(out.network[0].url, "https://example.test");
  assert.equal(out.network[0].status, null);
  assert.equal(run("console.error"), original);
  assert.equal(handlers.size, 0);
  assert.equal(observers[0].disconnected, true);
  run('diagnosticCollector("start","review")');
  timers.at(-1)!();
  assert.equal(run('diagnosticCollector("status","review").active'), false);
  assert.equal(run("console.warn"), original);
  run('diagnosticCollector("start","review")');
  assert.equal(run('diagnosticCollector("take","other-review")'), null);
  assert.equal(run('diagnosticCollector("status","review").active'), false);
});
