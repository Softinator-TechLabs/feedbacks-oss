import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

test(
  "both replay sanitizers preserve resource-free layout, variables and click geometry",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `
import {prepareReplayEvents} from './src/web/recordings/model.ts';
import {sanitizeSessionReplay} from './extension/session-replay.js';
window.sanitize=(events, extension)=>extension?sanitizeSessionReplay(events):prepareReplayEvents(events.map((data,seq)=>({type:'replay',seq,atMs:seq,data})));
`,
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "iife",
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      for (const extension of [false, true]) {
        const result = await page.evaluate((extension) => {
          const css = `:root{scroll-behavior:smooth;--gap:24px;--ink:#123456;--columns:repeat(2,minmax(0,1fr));--bad:u\\72l('/probe-variable')}body{margin:0}#form{display:grid;grid-template-columns:var(--columns);gap:var(--gap);width:600px}button{height:64px;background:var(--ink);color:white;border:0;font:600 16px/1.2 "Arial", sans-serif;border-radius:8px!important;width:100%}button{border-radius:0}#probe{background:u\\72l('/probe-direct')}`;
          const events = [
            {
              type: 2,
              data: {
                node: {
                  type: 2,
                  id: 1,
                  tagName: "style",
                  attributes: {},
                  childNodes: [{ type: 3, id: 2, textContent: css }],
                },
              },
            },
          ];
          const cleaned = (window as any).sanitize(events, extension)[0].data.node
            .childNodes[0].textContent;
          document.body.innerHTML =
            "<style>" +
            cleaned +
            '</style><div id="form"><button>First</button><button id="target">Submit</button></div>';
          const b = document.querySelector("#target")!;
          const s = getComputedStyle(b);
          const r = b.getBoundingClientRect();
          const blocked = (window as any).sanitize(
            [
              {
                type: 2,
                data: {
                  node: {
                    type: 2,
                    id: 3,
                    tagName: "input",
                    attributes: { rr_width: "0px", rr_height: "0px" },
                    childNodes: [],
                  },
                },
              },
            ],
            extension,
          )[0].data.node;
          const hidden = document.createElement(blocked.tagName);
          for (const [key, value] of Object.entries(blocked.attributes))
            hidden.setAttribute(key, String(value));
          document.body.prepend(hidden);
          return {
            scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
            blockedHeight: hidden.getBoundingClientRect().height,
            cleaned,
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
            color: s.backgroundColor,
            radius: s.borderRadius,
            font: s.fontFamily,
          };
        }, extension);
        assert.equal(result.scrollBehavior, "auto");
        assert.equal(result.blockedHeight, 0);
        assert.deepEqual(result.rect, { x: 312, y: 0, width: 288, height: 64 });
        assert.equal(result.color, "rgb(18, 52, 86)");
        assert.equal(result.radius, "8px");
        assert.match(result.font, /Arial/);
        assert.doesNotMatch(result.cleaned, /probe-|u\\72l|url\(/);
      }
    } finally {
      await browser.close();
    }
  },
);
