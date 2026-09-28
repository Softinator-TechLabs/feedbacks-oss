import { cp } from "node:fs/promises";
await cp(
  new URL("../public/learn/", import.meta.url),
  new URL("../site/public/learn/", import.meta.url),
  { recursive: true },
);
