import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { build } from "esbuild";
test(
  "MAIN stop retains a posted batch until the isolated bridge acknowledges durable ingestion",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `import {installSessionRecorder} from './extension/session-page.js';window.startCapture=()=>installSessionRecorder(()=>()=>{},{token:'test-token',debugger:true,remainingMs:300000,startedAt:Date.now(),privacy:{maskInputs:false,maskText:false}});`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "iife",
    });
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage();
      await page.setContent('<input aria-label="Last input">');
      await page.evaluate(() => {
        (window as any).posted = [];
        window.postMessage = (message: any) => {
          (window as any).posted.push(message);
        };
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => (window as any).startCapture());
      await page.getByLabel("Last input").fill("Value before immediate stop");
      await page.waitForTimeout(150);
      const tail = await page.evaluate(() => {
        const events = (window as any).__feedbacksSessionPageTake();
        (window as any).__feedbacksSessionPageStop();
        return events;
      });
      assert.ok(
        tail.some((event: any) => event.data.value === "Value before immediate stop"),
      );
      assert.ok(tail.every((event: any) => Number.isInteger(event.pageSeq)));
    } finally {
      await browser.close();
    }
  },
);

test(
  "navigation click reaches bridge before the link default action replaces its document",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `import {installSessionRecorder} from './extension/session-page.js';import {installSessionBridge} from './extension/session/session-bridge.js';window.sent=[];window.chrome={runtime:{sendMessage:async message=>{window.sent.push(message);return {ok:true};}}};installSessionBridge('test-token');installSessionRecorder(()=>()=>{},{token:'test-token',debugger:true,remainingMs:300000,startedAt:Date.now(),privacy:{maskInputs:false,maskText:false}});`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "iife",
    });
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage();
      await page.route("https://example.test/source", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<a href="https://example.test/destination">Go to My Manuscripts</a>',
        }),
      );
      await page.goto("https://example.test/source");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const beforeDefaultAction = await page.evaluate(() => {
        let clickAtDefault: any[] = [];
        document.querySelector("a")!.addEventListener("click", (event) => {
          clickAtDefault = (window as any).sent.flatMap(
            (message: any) => message.events || [],
          );
          event.preventDefault();
        });
        document.querySelector("a")!.click();
        (window as any).__feedbacksSessionPageStop();
        return clickAtDefault;
      });
      assert.ok(
        beforeDefaultAction.some(
          (event: any) =>
            event.data.action === "click" && event.data.label === "Go to My Manuscripts",
        ),
      );
    } finally {
      await browser.close();
    }
  },
);

test(
  "MAIN oversized DOM leaves clicks, inputs and console collection running",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `import {installSessionRecorder} from './extension/session-page.js'; window.run = () => installSessionRecorder(({emit}) => { window.replayEmit=emit; emit({type:2,timestamp:Date.now(),data:{text:'x'.repeat(7*1024*1024)}}); return () => {window.replayStopped=true;}; }, {token:'test',debugger:false,remainingMs:300000,startedAt:Date.now(),privacy:{maskInputs:false,maskText:false}});`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "iife",
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route("https://example.test/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<button>Continue</button><input aria-label="Title">',
        }),
      );
      await page.goto("https://example.test/");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => (window as any).run());
      await page.getByRole("button").click();
      await page.getByLabel("Title").fill("After DOM limit");
      const result = await page.evaluate(() => {
        console.warn("after-limit");
        const events = (window as any).__feedbacksSessionPageTake();
        (window as any).__feedbacksSessionPageStop();
        return { events, replayStopped: (window as any).replayStopped };
      });
      assert.ok(
        result.events.some((e: any) => e.data.action === "click"),
        "click after oversized DOM remains captured",
      );
      assert.ok(result.events.some((e: any) => e.data.value === "After DOM limit"));
      assert.ok(
        result.events.some(
          (e: any) => e.type === "console" && e.data.args.includes("after-limit"),
        ),
      );
      assert.ok(result.events.some((e: any) => e.data.action === "replay-unavailable"));
      assert.equal(result.replayStopped, true);
    } finally {
      await browser.close();
    }
  },
);
