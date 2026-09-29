import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { chromium } from "playwright";

test(
  "capture storage persists large baselines across reload and atomically rejects failed writes",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const source = await readFile(
      new URL("../extension/session/session-storage.js", import.meta.url),
    );
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url === "/storage.js" ? "text/javascript" : "text/html",
      );
      res.end(
        req.url === "/storage.js" ? source : "<!doctype html><body>Storage test</body>",
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.addInitScript("window.__name = (value) => value;");
      await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
      await page.evaluate(async () => {
        const { createSessionStorage } = await import(String("/storage.js"));
        const storage = createSessionStorage();
        const data = {
          active: true,
          recording: {
            id: "test",
            events: [
              { seq: 0, data: "a".repeat(6 * 1024 * 1024) },
              { seq: 1, data: "b".repeat(5 * 1024 * 1024) },
            ],
          },
        };
        await storage.set({ feedbacksSessionCaptureV1: data });
      });
      await page.reload();
      const result = await page.evaluate(async () => {
        const { createSessionStorage } = await import(String("/storage.js"));
        const storage = createSessionStorage();
        const key = "feedbacksSessionCaptureV1";
        const data = (await storage.get(key))[key];
        const lengths = data.recording.events.map((e: any) => e.data.length);
        data.recording.events.push({ seq: 2, data: "click" });
        await storage.set({ [key]: data });
        data.recording.events.push({ seq: 3, data: () => "uncloneable" });
        let rejected = false;
        try {
          await storage.set({ [key]: data });
        } catch {
          rejected = true;
        }
        const afterFailure = (await storage.get(key))[key];
        afterFailure.active = false;
        afterFailure.recording.events.reverse().forEach((e: any, seq: number) => {
          e.seq = seq;
        });
        await storage.set({ [key]: afterFailure });
        const stopped = (await storage.get(key))[key];
        await storage.remove(key);
        return {
          lengths,
          rejected,
          count: afterFailure.recording.events.length,
          first: stopped.recording.events[0].data,
          empty: !(await storage.get(key))[key],
        };
      });
      assert.deepEqual(result, {
        lengths: [6 * 1024 * 1024, 5 * 1024 * 1024],
        rejected: true,
        count: 3,
        first: "click",
        empty: true,
      });
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);
