export function formatPageQa(scan, pageUrl) {
  const pageOrigin = new URL(pageUrl).origin;
  if (
    !scan ||
    !Array.isArray(scan.missingAlt) ||
    !Array.isArray(scan.brokenLinks) ||
    scan.missingAlt.length > 10 ||
    scan.brokenLinks.length > 12 ||
    !Number.isSafeInteger(scan.checkedLinks) ||
    scan.checkedLinks < 0 ||
    scan.checkedLinks > 12
  )
    throw Error("The page scan returned invalid results. Try again.");
  const lines = [];
  for (const y of scan.missingAlt) {
    if (!Number.isSafeInteger(y) || y < 0 || y > 10_000_000)
      throw Error("The page scan returned invalid image locations.");
    lines.push(`- Image near page y=${y}px has no alt attribute.`);
  }
  for (const item of scan.brokenLinks) {
    if (![404, 410].includes(item?.status) || typeof item.url !== "string")
      throw Error("The page scan returned invalid link results.");
    const url = new URL(item.url);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.origin !== pageOrigin ||
      url.username ||
      url.password ||
      item.url.length > 500
    )
      throw Error("The page scan returned an unsafe link.");
    lines.push(`- Link returned HTTP ${item.status}: ${url.origin}${url.pathname}`);
  }
  if (!lines.length) return null;
  return `Page QA scan. Review these findings before sending:\n\n${lines.join("\n")}\n\nChecked only visible DOM images and up to 12 same-origin links. Cross-origin links were not tested.`;
}
