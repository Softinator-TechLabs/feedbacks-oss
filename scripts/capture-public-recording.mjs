// Actual current inspector with synthetic events. No server or customer data.
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
const result = await build({
  stdin: {
    contents: `
import {createSessionReview} from './extension/session-review.js';
const media = new EventTarget();
Object.assign(media,{currentTime:5,paused:true,pause(){this.paused=true;this.dispatchEvent(new Event('pause'));},async play(){this.paused=false;this.dispatchEvent(new Event('play'));}});
createSessionReview(document.querySelector('#inspector'), {videoElement:media,video:{offsetMs:0},recording:{durationMs:8000,environment:{browser:'Chrome',viewport:{width:1440,height:900}},privacy:{maskInputs:true},events:[
{seq:0,atMs:2000,type:'activity',data:{action:'click',label:'Place order',selector:'button.checkout',x:512,y:346,button:0}},
{seq:1,atMs:4000,type:'network',data:{phase:'response',requestId:'checkout-1',method:'POST',url:'https://shop.example/checkout',status:500}},
{seq:2,atMs:5000,type:'console',data:{level:'error',text:'Checkout request failed',args:['Checkout request failed']}},
{seq:3,atMs:6000,type:'performance',data:{name:'load',duration:240}}
]}});
`,
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  write: false,
  format: "iife",
});
const css = (
  await Promise.all(
    ["appearance.css", "video.css", "session-review.css"].map((name) =>
      readFile(`extension/${name}`, "utf8"),
    ),
  )
).join("\n");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}\nbody{margin:0;background:#fff;padding:24px;font-family:system-ui;color:#172739}#capture{max-width:980px;margin:auto}h1{font-size:21px;margin:0 0 6px}.capture-label{font-size:13px;color:#526577;margin:0 0 18px}.session-review{margin:0}button{font-family:inherit}</style></head><body><main id="capture"><h1>Checkout fails after placing an order</h1><p class="capture-label">Feedbacks recording review · synthetic example</p><div id="inspector"></div></main><script src="/bundle.js"></script></body></html>`;
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/bundle.js" ? "text/javascript" : "text/html",
  );
  res.end(req.url === "/bundle.js" ? result.outputFiles[0].text : html);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1028, height: 950 },
    deviceScaleFactor: 1,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".review-tabs").waitFor();
  await mkdir("site/public/media/story", { recursive: true });
  const png = await page.locator("#capture").screenshot();
  await sharp(png)
    .webp({ quality: 86 })
    .toFile("site/public/media/story/recording-inspector.webp");
  console.log("Captured current recording inspector with synthetic events.");
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
