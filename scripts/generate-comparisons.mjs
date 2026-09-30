import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import prettier from "prettier";
import { comparisons } from "../site/comparison-data.mjs";
import {
  matrixFeatures,
  matrixGroups,
  matrixReviewed,
  matrixRows,
  vendorAudits,
} from "../site/comparison-matrix.mjs";

const site = resolve(import.meta.dirname, "../site");
const out = resolve(site, "compare");
const home = "https://feedbacks.softinator.ai";
const store =
  "https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo";
const source = "https://github.com/Softinator-TechLabs/feedbacks-oss";
const check = process.argv.includes("--check");
const externalLink = 'target="_blank" rel="nofollow noopener noreferrer"';

function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
      character
    ];
  });
}

function shell({ title, description, canonical, content }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escape(description)}" />
    <meta name="theme-color" content="#fffdfa" />
    <meta property="og:title" content="${escape(title)}" />
    <meta property="og:description" content="${escape(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${home}/media/social-preview.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta property="og:url" content="${canonical}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/site.css" />
    <link rel="stylesheet" href="/comparison.css" />
    <script src="/comparison.js?v=20260930-audit" defer></script>
    <title>${escape(title)}</title>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header wrap compare-header">
      <a class="wordmark" href="/" aria-label="Feedbacks home"><img src="/favicon.svg" width="30" height="30" alt="" />feedbacks<span class="wordmark-dot">.</span></a>
      <nav aria-label="Main navigation"><a href="/">Home</a><a href="/compare/">Compare tools</a><a href="/docs/">Docs</a><a href="${source}" ${externalLink}>GitHub <span aria-hidden="true">↗</span></a></nav>
      <a class="button header-cta" href="/docs/guide/getting-started">Set up Feedbacks <span aria-hidden="true">→</span></a>
    </header>
    <main id="main">${content}</main>
    <footer class="site-footer wrap compare-footer">
      <div><a class="wordmark" href="/">feedbacks.</a><p>By <a href="https://softinator.ai" ${externalLink}>Softinator</a>. Built in the open.</p></div>
      <nav aria-label="Footer navigation"><a href="/compare/">All comparisons</a><a href="${source}" ${externalLink}>Source</a><a href="/privacy.html">Privacy</a></nav>
    </footer>
  </body>
</html>`;
}

const statusLabels = {
  yes: "✓ Yes",
  no: "❌ No",
  unknown: "Not verified",
  paid: "✓ Paid",
  partial: "Partial",
  external: "External",
  parts: "Parts",
};
const basisLabels = {
  source: "Public source audit",
  documentation: "Official documentation",
  explicit: "Explicit published limit",
  scope: "Documented product/tool inventory",
};
function evidenceCell(entry, key, label) {
  const evidence = matrixRows[entry.slug][key];
  const iso = new Date(`${evidence.reviewed} UTC`).toISOString().slice(0, 10);
  const shortDate = new Date(`${evidence.reviewed} UTC`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const title = `${entry.name} · ${label}`;
  const scope =
    vendorAudits[entry.slug]?.scope ??
    "Feedbacks public source b9b7df4; installed versions may differ.";
  return `<td class="matrix-${evidence.status}${entry.slug === "feedbacks" ? " matrix-ours" : ""}"><details class="matrix-evidence" name="comparison-evidence"><summary aria-label="${escape(title)}: ${escape(statusLabels[evidence.status])}. Checked ${escape(evidence.reviewed)}. Show evidence." data-evidence-title="${escape(title)}"><span class="matrix-verdict">${escape(statusLabels[evidence.status])}</span><time datetime="${iso}">${escape(shortDate)}</time></summary><div class="matrix-evidence-body"><p class="evidence-verdict"><strong>${escape(statusLabels[evidence.status])}</strong> · Checked ${escape(evidence.reviewed)}</p><p>${escape(evidence.detail)}</p><p class="evidence-basis">${escape(basisLabels[evidence.basis])}</p><p class="evidence-scope">${escape(scope)}</p><a href="${escape(evidence.url)}" ${externalLink}>Read source <span aria-hidden="true">↗</span></a></div></details></td>`;
}
function matrix(activeSlug) {
  const entries = [
    { slug: "feedbacks", name: "Feedbacks" },
    ...comparisons.filter((entry) => !activeSlug || entry.slug === activeSlug),
  ];
  const vendorCount = entries.length - 1;
  const unknownCount = entries.reduce(
    (sum, entry) =>
      sum +
      Object.values(matrixRows[entry.slug]).filter((cell) => cell.status === "unknown")
        .length,
    0,
  );
  const headers = entries
    .map(
      (entry) =>
        `<th scope="col" data-tool="${entry.slug}"${entry.slug === "feedbacks" ? ' class="matrix-ours"' : ""}><a href="${entry.slug === "feedbacks" ? "/" : `/compare/${entry.slug}.html`}">${escape(entry.name)}</a>${entry.slug === "bugpin" ? "<small>Community + noted EE</small>" : entry.slug === "openreplay" ? "<small>Core + Spot</small>" : ""}</th>`,
    )
    .join("");
  const bodies = matrixGroups
    .map(
      (group) =>
        `<tbody><tr class="matrix-group-row" id="matrix-${group.id}"><th scope="rowgroup" colspan="${entries.length + 1}"><span>${escape(group.title)}</span></th></tr>${group.features.map(([key, label]) => `<tr data-feature="${key}"><th scope="row">${escape(label)}</th>${entries.map((entry) => evidenceCell(entry, key, label)).join("")}</tr>`).join("")}</tbody>`,
    )
    .join("");
  return `<section class="compare-matrix" aria-labelledby="matrix-heading">
    <div class="comparison-overview"><h2 id="matrix-heading">${matrixFeatures.length} capabilities · ${activeSlug ? `Feedbacks + ${escape(entries[1].name)}` : `${entries.length} tools`}</h2>
    <nav class="matrix-jump" aria-label="Feature categories">${matrixGroups.map((group) => `<a href="#matrix-${group.id}">${escape({ highlights: "Highlights", capture: "Capture", annotation: "Image tools", recording: "Recordings", collaboration: "Team & agents", hosting: "Self-hosting" }[group.id] ?? group.title)}</a>`).join("")}</nav>
    <p class="matrix-key"><strong>✓ Yes</strong> <span>·</span> <strong>❌ No</strong> In the reviewed scope <span>·</span> <strong>Paid</strong> Paid edition <span>·</span> <strong>Partial</strong> Related support <span>·</span> <strong>External / Parts</strong> Requires another tool</p>
    <p class="matrix-date">Reviewed ${matrixReviewed}. ${unknownCount}/${matrixFeatures.length * entries.length} verdicts remain <strong>Not verified</strong>; each explains the evidence gap. <a href="/docs/reference/comparison-method">How we audit</a>.</p></div>
    <div class="matrix-controls" aria-label="Comparison table navigation" hidden><p>Swipe or scroll. Feature labels and Feedbacks stay visible.</p><div><button type="button" class="matrix-prev" aria-label="Previous comparison tools" disabled>←</button><span class="matrix-position" aria-live="polite">Tool 1 of ${vendorCount}</span><button type="button" class="matrix-next" aria-label="Next comparison tools">→</button></div></div>
    <div class="matrix-scroll" role="region" aria-label="Comprehensive capability comparison" tabindex="0"><table class="matrix-tools-${entries.length}"><caption>All ${matrixFeatures.length} capabilities: Feedbacks and ${activeSlug ? escape(entries[1].name) : `${vendorCount} website feedback tools`}, with dated evidence</caption><colgroup><col class="matrix-feature-column"/>${entries.map(() => '<col class="matrix-tool-column"/>').join("")}</colgroup><thead><tr><th scope="col">Capability</th>${headers}</tr></thead>${bodies}</table></div>
    <aside id="evidence-popover" class="evidence-popover" popover role="dialog" aria-labelledby="evidence-title"><button type="button" class="evidence-close">Close evidence <span aria-hidden="true">×</span></button><h3 id="evidence-title"></h3><div class="evidence-content"></div></aside>
    </section>`;
}

function detail(entry, index) {
  const siblings = [
    comparisons[(index + comparisons.length - 1) % comparisons.length],
    comparisons[(index + 1) % comparisons.length],
  ];
  const canonical = `${home}/compare/${entry.slug}.html`;
  return shell({
    title: `Feedbacks vs ${entry.name} | Website feedback comparison`,
    description: `${vendorAudits[entry.slug].summary} Dated evidence for all 49 capabilities.`,
    canonical,
    content: `<div class="compare-page wrap">
      <p class="compare-return"><a href="/compare/">All comparisons</a> / ${escape(entry.name)}</p>
      <div class="compare-hero">
        <h1>Feedbacks <span>or</span> ${escape(entry.name)}?</h1>
        <p>${escape(vendorAudits[entry.slug].summary)}</p>
      </div>
      ${matrix(entry.slug)}
      <aside class="compare-limits">
        <h2>What Feedbacks does today.</h2>
        <p>Recording starts explicitly and is bounded to five minutes; video has a 40 MiB limit. Optional audio, network bodies and masking have separate controls. Edited video omits DOM replay. Screenshot diagnostic artifacts can contain raw browser values and do not inherit session masking. Check capture coverage and review evidence before sharing.</p>
        <p>GitHub supports multiple configured Apps on one server. The owner selects one App per project; repositories can span that App’s permitted installations. Incoming comments do not automatically create Issues. Self-hosting infrastructure and any AI-model subscriptions are supplied by your team.</p>
        <p>Reviewer expertise belongs in owner-approved guidance. A private member note or profile field is not automatically shared with an ordinary agent. Guidance helps interpretation but never grants permissions or guarantees how a model will decide.</p>
      </aside>
      <div class="compare-actions"><a class="button primary" href="/docs/guide/getting-started">Set up Feedbacks</a><a href="/docs/guide/session-replay">Explore recordings and replay</a></div>
      <section class="compare-sources" aria-labelledby="compare-sources-heading">
        <h2 id="compare-sources-heading">Sources and scope.</h2>
        <p>All feature verdicts reviewed ${matrixReviewed}. ${escape(vendorAudits[entry.slug].scope)}</p>

        <ul>
          <li><a href="${source}/blob/HEAD/docs/why-feedbacks.md" ${externalLink}>Feedbacks product boundaries</a></li>
          <li><a href="${source}/blob/HEAD/docs/extension.md" ${externalLink}>Feedbacks capture, editing and recording</a></li>
          <li><a href="${source}/blob/HEAD/docs/session-replay.md" ${externalLink}>Feedbacks session replay and debug bundles</a></li>
          <li><a href="${source}/blob/HEAD/docs/agents.md" ${externalLink}>Feedbacks agent context</a></li>
          <li><a href="${source}/blob/HEAD/docs/self-hosting.md" ${externalLink}>Feedbacks self-hosting</a></li>
          ${vendorAudits[entry.slug].sources.map(({ title, url, reviewed: date }) => `<li><a href="${escape(url)}" ${externalLink}>${escape(title)}</a> <span>— checked ${escape(date)}</span></li>`).join("")}
        </ul>
      </section>
      <nav class="compare-next" aria-label="Other comparisons"><a href="/compare/${siblings[0].slug}.html">← ${escape(siblings[0].name)}</a><a href="/compare/${siblings[1].slug}.html">${escape(siblings[1].name)} →</a></nav>
    </div>`,
  });
}

function indexPage() {
  const groups = ["Open source", "Hosted tools"];
  const canonical = `${home}/compare/`;
  return shell({
    title: "Compare Feedbacks with website feedback tools",
    description:
      "Compare Feedbacks and 15 alternatives across 49 features: visual review, video, session replay, debugging, MCP and self-hosting. Every verdict has dated evidence.",
    canonical,
    content: `<div class="compare-index wrap">
      <h1>Website feedback tools, compared.</h1>
      <p class="compare-index-intro">Visual review, video, replay, debugging and agent handoff. Open a verdict for dated evidence.</p>

      ${matrix()}
      ${groups
        .map(
          (group) =>
            `<section class="compare-group" aria-label="${group}"><h2>${group}</h2><div class="compare-list">${comparisons
              .filter((entry) => entry.group === group)
              .map(
                (entry) =>
                  `<a href="/compare/${entry.slug}.html"><strong>${escape(entry.name)}</strong><span>${escape(vendorAudits[entry.slug].summary)}</span><span aria-hidden="true">↗</span></a>`,
              )
              .join("")}</div></section>`,
        )
        .join("")}
      <div class="compare-index-end"><p>Own the full stack. Keep the thread.</p><a class="button primary" href="/docs/guide/getting-started">Set up Feedbacks</a><a href="${source}" ${externalLink}>Explore the source</a></div>
    </div>`,
  });
}

async function put(path, content) {
  const config = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(content, { ...config, parser: "html" });
  if (check) {
    if ((await readFile(path, "utf8").catch(() => "")) !== formatted) {
      throw new Error(`${path} is stale; run npm run site:comparisons`);
    }
    return;
  }
  await writeFile(path, formatted);
}

if (new Set(comparisons.map((entry) => entry.slug)).size !== comparisons.length) {
  throw new Error("Duplicate comparison slug");
}
for (const entry of comparisons) {
  if (!/^[a-z0-9-]+$/.test(entry.slug) || !vendorAudits[entry.slug]?.sources.length) {
    throw new Error(`Invalid comparison entry: ${entry.slug}`);
  }
}
if (
  Object.keys(matrixRows).length !== comparisons.length + 1 ||
  comparisons.some((entry) => !matrixRows[entry.slug])
) {
  throw new Error("Comparison matrix rows do not match comparison pages");
}
for (const [slug, row] of Object.entries(matrixRows)) {
  if (
    Object.keys(row).length !== matrixFeatures.length ||
    matrixFeatures.some(([key]) => !row[key])
  )
    throw new Error(`Incomplete audit: ${slug}`);
  for (const [key, evidence] of Object.entries(row)) {
    if (
      !matrixFeatures.some(([feature]) => feature === key) ||
      !statusLabels[evidence.status] ||
      !basisLabels[evidence.basis] ||
      !evidence.detail ||
      evidence.detail.length < 15 ||
      !/^https:\/\//.test(evidence.url) ||
      !/^\d{1,2} [A-Za-z]+ \d{4}$/.test(evidence.reviewed)
    ) {
      throw new Error(`Invalid matrix evidence: ${slug}.${key}`);
    }
  }
}
await mkdir(out, { recursive: true });
await put(resolve(out, "index.html"), indexPage());
for (const [index, entry] of comparisons.entries()) {
  await put(resolve(out, `${entry.slug}.html`), detail(entry, index));
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
  `${home}/`,
  `${home}/privacy.html`,
  `${home}/compare/`,
  ...comparisons.map((entry) => `${home}/compare/${entry.slug}.html`),
]
  .map((url) => `  <url><loc>${url}</loc></url>`)
  .join("\n")}\n</urlset>\n`;
const sitemapPath = resolve(site, "public/sitemap.xml");
if (check) {
  if ((await readFile(sitemapPath, "utf8")) !== sitemap) {
    throw new Error("Sitemap is stale; run npm run site:comparisons");
  }
  const actual = (await readdir(out)).filter((file) => file.endsWith(".html"));
  if (actual.length !== comparisons.length + 1) {
    throw new Error("Comparison pages do not match comparison data");
  }
  const landing = await readFile(resolve(site, "index.html"), "utf8");
  for (const entry of comparisons) {
    if (!landing.includes(`/compare/${entry.slug}.html`)) {
      throw new Error(`Landing footer is missing ${entry.slug}`);
    }
  }
} else {
  await writeFile(sitemapPath, sitemap);
}
console.log(
  `Verified ${comparisons.length} comparison pages and index${check ? "" : " (generated)"}.`,
);
