import { fail } from "./errors.js";

// Store only the file key and an optional selected node. Share URLs can carry
// unrelated query parameters and fragments that should not become thread data.
export function figmaReferenceUrl(value: string): string {
  const url = new URL(value);
  const match = url.pathname.match(
    /^\/(design|file|board|proto|slides|deck)\/([A-Za-z0-9]{8,128})(?:\/[^/]*)?\/?$/,
  );
  if (
    url.protocol !== "https:" ||
    !["figma.com", "www.figma.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !match
  )
    fail("VALIDATION", "Expected a Figma design, board, prototype or slides file URL");

  const nodeIds = url.searchParams.getAll("node-id");
  if (nodeIds.length > 1 || (nodeIds.length && !/^\d+[-:]\d+$/.test(nodeIds[0])))
    fail("VALIDATION", "Invalid Figma node-id");
  const canonical = new URL(`https://www.figma.com/${match[1]}/${match[2]}`);
  if (nodeIds.length) canonical.searchParams.set("node-id", nodeIds[0]);
  return canonical.toString();
}
