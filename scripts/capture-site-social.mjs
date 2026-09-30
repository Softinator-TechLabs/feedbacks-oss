import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const font = (await readFile("site/public/fonts/manrope-800.ttf")).toString("base64");
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Manrope;src:url(data:font/ttf;base64,${font})}*{box-sizing:border-box}body{margin:0;background:#fffdfa;color:#20241e;font-family:Manrope,Arial;padding:52px 64px}header{font-size:28px}header span{color:#dc452c}h1{font-size:65px;line-height:1.12;letter-spacing:-2px;margin:45px 0 25px}p{font:22px Arial;margin:0;color:#505767}.license{font:700 21px Arial;color:#285831;margin-top:34px}.timeline{display:flex;gap:65px;border-top:3px solid #bcc7d6;margin-top:48px;padding-top:20px;font:18px Arial}.timeline span:before{content:'';display:inline-block;width:12px;height:12px;background:#a43e17;border-radius:50%;margin-right:12px}</style><header>feedbacks<span>.</span></header><h1>Show the bug.<br>Keep the whole story.</h1><p>Visual feedback, session replay and debugging evidence.</p><div class="license">100% free · Apache-2.0 · Self-hosted</div><div class="timeline"><span>Capture the moment</span><span>Inspect the evidence</span><span>Give your agent context</span></div>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "site/public/media/social-preview.png" });
  console.log("Rendered 1200 × 630 social preview.");
} finally {
  await browser.close();
}
