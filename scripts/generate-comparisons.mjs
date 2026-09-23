import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import prettier from "prettier";
import { comparisons, reviewed } from "../site/comparison-data.mjs";
import {
  matrixFeatures,
  matrixReviewed,
  matrixRows,
} from "../site/comparison-matrix.mjs";

const site = resolve(import.meta.dirname, "../site");
const out = resolve(site, "compare");
const home = "https://feedbacks.softinator.ai";
const store =
  "https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo";
const source = "https://github.com/Softinator-TechLabs/feedbacks-oss";
const check = process.argv.includes("--check");

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
    <meta property="og:url" content="${canonical}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/site.css" />
    <link rel="stylesheet" href="/comparison.css" />
    <title>${escape(title)}</title>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header wrap compare-header">
      <a class="wordmark" href="/" aria-label="Feedbacks home"><img src="/favicon.svg" width="30" height="30" alt="" />feedbacks<span class="wordmark-dot">.</span></a>
      <nav aria-label="Main navigation"><a href="/">Home</a><a href="/compare/">Compare tools</a><a href="${source}">GitHub <span aria-hidden="true">↗</span></a></nav>
      <a class="button header-cta" href="${store}">Get it for Chrome <span aria-hidden="true">↗</span></a>
    </header>
    <main id="main">${content}</main>
    <footer class="site-footer wrap compare-footer">
      <div><a class="wordmark" href="/">feedbacks.</a><p>By <a href="https://softinator.ai">Softinator</a>. Built in the open.</p></div>
      <nav aria-label="Footer navigation"><a href="/compare/">All comparisons</a><a href="${source}">Source</a><a href="/privacy.html">Privacy</a></nav>
    </footer>
  </body>
</html>`;
}

const ours = {
  capture:
    "Chrome extension: screenshot any supported web page, draw with the pencil and discuss in a project thread.",
  hosting:
    "Apache-2.0 backend, web app, extension, MCP and CLI. Run them with your PostgreSQL and private S3-compatible storage.",
  agents:
    "Scoped MCP access to the thread, replies, screenshot and owner-approved reviewer guidance. Expertise weights are advisory.",
  handoff:
    "Clarify quick requests in the thread. Create and link GitHub Issues through your existing workflow when the work is agreed.",
};

const statusLabels = {
  yes: "✓",
  no: "✕",
  paid: "Paid",
  required: "External",
  components: "Parts",
  manual: "Manual",
};

function matrix(activeSlug) {
  const entries = [{ slug: "feedbacks", name: "Feedbacks" }, ...comparisons];
  const header = matrixFeatures
    .map(([, label]) => `<th scope="col">${escape(label)}</th>`)
    .join("");
  const rows = entries
    .map((entry) => {
      const cells = matrixFeatures
        .map(([key, label]) => {
          const evidence = matrixRows[entry.slug]?.[key];
          if (!evidence) {
            return `<td class="matrix-unknown"><span aria-label="${escape(entry.name)}: ${escape(label)} not verified">?</span></td>`;
          }
          const symbol = statusLabels[evidence.status];
          const value = evidence.status === "yes" ? "Confirmed" : symbol;
          return `<td class="matrix-${evidence.status}"><a href="${escape(evidence.url)}" aria-label="${escape(entry.name)}: ${escape(label)}. ${escape(value)}. Read source." title="Read source for ${escape(entry.name)}: ${escape(label)}">${escape(symbol)}</a></td>`;
        })
        .join("");
      const name =
        entry.slug === "feedbacks"
          ? `<a href="/">Feedbacks</a>`
          : `<a href="/compare/${entry.slug}.html">${escape(entry.name)}</a>`;
      return `<tr${entry.slug === activeSlug ? ' class="matrix-active"' : ""}><th scope="row">${name}</th>${cells}</tr>`;
    })
    .join("");
  return `<section class="compare-matrix" aria-labelledby="matrix-heading">
    <div class="matrix-intro"><h2 id="matrix-heading">The whole field, at a glance.</h2><p>Scroll across for every column. Open any mark to see the evidence.</p></div>
    <div class="matrix-scroll" role="region" aria-label="Feature comparison table" tabindex="0">
      <table><caption>Feedbacks and 15 website feedback tools, compared by documented capability</caption><thead><tr><th scope="col">Tool</th>${header}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <p class="matrix-key"><strong>✓</strong> Confirmed <span>·</span> <strong>✕</strong> Not in the linked public product or edition <span>·</span> <strong>?</strong> Evidence insufficient <span>·</span> <strong>Parts</strong> Components to assemble <span>·</span> <strong>External</strong> Required account <span>·</span> <strong>Paid</strong> Paid edition <span>·</span> <strong>Manual</strong> Manual handoff</p>
    <p class="matrix-date">Documentation and available public source checked ${matrixReviewed}. A cross describes the documented product or edition, not every private offer or future release. Features and plans can change. Recording means creating a feedback video or session replay, not reviewing an uploaded video. A tick does not imply identical workflows.</p>
  </section>`;
}

function detail(entry, index) {
  const row = (name, us, them) => `<div class="compare-row">
    <h3>${name}</h3>
    <p><strong>Feedbacks</strong>${escape(us)}</p>
    <p><strong>${escape(entry.name)}</strong>${escape(them)}</p>
  </div>`;
  const siblings = [
    comparisons[(index + comparisons.length - 1) % comparisons.length],
    comparisons[(index + 1) % comparisons.length],
  ];
  const canonical = `${home}/compare/${entry.slug}.html`;
  return shell({
    title: `Feedbacks vs ${entry.name} | Website feedback comparison`,
    description: `${entry.summary} Compare capture, hosting, agent context and handoff using the official sources.`,
    canonical,
    content: `<div class="compare-page wrap">
      <p class="compare-return"><a href="/compare/">All comparisons</a> / ${escape(entry.name)}</p>
      <div class="compare-hero">
        <h1>Feedbacks <span>or</span> ${escape(entry.name)}?</h1>
        <p>${escape(entry.summary)}</p>
      </div>
      <div class="compare-choices" aria-label="When to choose each tool">
        <p><strong>${escape(entry.name)}</strong>${escape(entry.bestFor)}</p>
        <p><strong>Feedbacks</strong>${escape(entry.feedbacksBest)}</p>
      </div>
      ${matrix(entry.slug)}
      <section class="compare-facts" aria-labelledby="compare-facts-heading">
        <h2 id="compare-facts-heading">How the work moves.</h2>
        ${row("Capture", ours.capture, entry.theirCapture)}
        ${row("Hosting & source", ours.hosting, entry.theirHosting)}
        ${row("Coding agents", ours.agents, entry.theirAI)}
        ${row("Next step", ours.handoff, entry.theirHandoff)}
      </section>
      <aside class="compare-limits">
        <h2>What Feedbacks does today.</h2>
        <p>Feedbacks is an early 0.x product. GitHub Issues and Projects are a manual handoff, not an automatic sync. It does not include video replay, surveys or an AI model subscription. Self-hosting has no Feedbacks license fee; you still pay for your server, database, storage and operations.</p>
        <p>Reviewer expertise belongs in owner-approved guidance. A private member note or profile field is not automatically shared with an ordinary agent. Guidance helps interpretation but never grants permissions or guarantees how a model will decide.</p>
      </aside>
      <div class="compare-actions"><a class="button primary" href="${store}">Get the Chrome extension</a><a href="${source}/blob/HEAD/docs/self-hosting.md">Self-host Feedbacks</a></div>
      <section class="compare-sources" aria-labelledby="compare-sources-heading">
        <h2 id="compare-sources-heading">Sources and scope.</h2>
        <p>Checked ${reviewed}. This is a comparison of published product documentation, not a hands-on certification of every plan or deployment. Features and plans can change.</p>
        ${entry.scopeNote ? `<p>${escape(entry.scopeNote)}</p>` : ""}
        <ul>
          <li><a href="${source}/blob/HEAD/docs/why-feedbacks.md">Feedbacks product boundaries</a></li>
          <li><a href="${source}/blob/HEAD/docs/self-hosting.md">Feedbacks self-hosting</a></li>
          ${entry.sources.map(([label, url]) => `<li><a href="${escape(url)}">${escape(label)}</a></li>`).join("")}
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
      "A clear look at Feedbacks and other visual feedback tools. Compare capture, self-hosting, agent context and handoff with direct sources.",
    canonical,
    content: `<div class="compare-index wrap">
      <h1>Choose where your feedback lives.</h1>
      <p class="compare-index-intro">Some tools start with a widget. Some start with a recording or a canvas. Feedbacks starts with a screenshot, a pencil mark and a discussion your team and agent can follow on your own server.</p>
      <p class="compare-index-note">Several tools here also offer MCP, self-hosting or both. Each page links to the vendor's own description, and makes the tradeoffs clear.</p>
      ${matrix()}
      ${groups
        .map(
          (group) =>
            `<section class="compare-group" aria-label="${group}"><h2>${group}</h2><div class="compare-list">${comparisons
              .filter((entry) => entry.group === group)
              .map(
                (entry) =>
                  `<a href="/compare/${entry.slug}.html"><strong>${escape(entry.name)}</strong><span>${escape(entry.summary)}</span><span aria-hidden="true">↗</span></a>`,
              )
              .join("")}</div></section>`,
        )
        .join("")}
      <div class="compare-index-end"><p>Own the full stack. Keep the thread.</p><a class="button primary" href="${store}">Get the Chrome extension</a><a href="${source}">Explore the source</a></div>
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
  if (!/^[a-z0-9-]+$/.test(entry.slug) || entry.sources.length === 0) {
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
  for (const [key, evidence] of Object.entries(row)) {
    if (
      !matrixFeatures.some(([feature]) => feature === key) ||
      !statusLabels[evidence.status] ||
      !/^https:\/\//.test(evidence.url)
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
