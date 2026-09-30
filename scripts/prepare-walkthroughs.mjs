import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import sharp from "sharp";

// Each surface serves the same local bundle of the actual extension inspector.
// Generated files are ignored; the renderer and walkthrough source stay tracked.
await build({
  entryPoints: [new URL("walkthrough-recording.js", import.meta.url).pathname],
  outfile: new URL("../public/learn/recording-runtime.js", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
const [reviewCss, walkthroughCss] = await Promise.all([
  readFile(new URL("../extension/session-review.css", import.meta.url), "utf8"),
  readFile(new URL("walkthrough-recording.css", import.meta.url), "utf8"),
]);
await writeFile(
  new URL("../public/learn/recording-review.css", import.meta.url),
  `${reviewCss}\n${walkthroughCss}`,
);
await rm(new URL("../site/public/learn/", import.meta.url), {
  recursive: true,
  force: true,
});
await rm(new URL("../public/learn/studio-chair.png", import.meta.url), { force: true });
await sharp(new URL("../site/public/media/studio-chair.png", import.meta.url).pathname)
  .resize({ width: 820, withoutEnlargement: true })
  .webp({ quality: 82 })
  .toFile(new URL("../public/learn/studio-chair.webp", import.meta.url).pathname);
await cp(
  new URL("../public/learn/", import.meta.url),
  new URL("../site/public/learn/", import.meta.url),
  { recursive: true },
);

// Public diagrams share one source with the landing page.
await cp(
  new URL("../site/public/media/story/", import.meta.url),
  new URL("../site-docs/public/media/story/", import.meta.url),
  { recursive: true },
);

// Keep the original capture for reproduction; serve a sized modern fallback.
await sharp(new URL("../site/public/media/workflow/point.png", import.meta.url).pathname)
  .resize({ width: 1200, withoutEnlargement: true })
  .webp({ quality: 82 })
  .toFile(
    new URL("../site/public/media/workflow/point-preview.webp", import.meta.url).pathname,
  );
