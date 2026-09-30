import { cp } from "node:fs/promises";
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
