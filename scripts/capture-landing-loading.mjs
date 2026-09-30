// Capture the current synthetic player at its first frame, including its authored
// depth treatment, so cold loading never flashes the older full editor screenshot.
// Run npm run build:site, then point this script at the local static preview.
import { chromium } from "playwright";
import sharp from "sharp";
const origin = process.env.FEEDBACKS_PREVIEW_URL || "http://127.0.0.1:4174";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname))
  throw new Error("Use a loopback synthetic preview, not a live installation.");
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.addInitScript(() => localStorage.setItem("feedbacks-motion", "paused"));
    await page.goto(origin);
    const demo = page.locator(".product-hero-demo feedbacks-demo");
    await demo.locator("canvas").waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Freeze time for capture but show the default autoplay control label.
    await demo.locator(".play").evaluate((button) => {
      button.textContent = "Pause";
    });
    // Capture the exact starting layout, independent of elapsed playback time.
    const stage = demo.locator(".depth-stage");
    await stage.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    const png = await stage.screenshot();
    const output = `site/public/media/story/loading-${width > 800 ? "desktop" : "mobile"}-v2.webp`;
    await sharp(png).webp({ quality: 85 }).toFile(output);
    console.log(output, await demo.boundingBox());
    await page.close();
  }
} finally {
  await browser.close();
}
