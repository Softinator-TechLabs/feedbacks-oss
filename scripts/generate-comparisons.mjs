import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import prettier from "prettier";
import { comparisons, reviewed } from "../site/comparison-data.mjs";
import {
  matrixFeatures,
  matrixGroups,
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
    <meta property="og:url" content="${canonical}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/site.css" />
    <link rel="stylesheet" href="/comparison.css" />
    <script src="/comparison.js" defer></script>
    <title>${escape(title)}</title>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header wrap compare-header">
      <a class="wordmark" href="/" aria-label="Feedbacks home"><img src="/favicon.svg" width="30" height="30" alt="" />feedbacks<span class="wordmark-dot">.</span></a>
      <nav aria-label="Main navigation"><a href="/">Home</a><a href="/compare/">Compare tools</a><a href="${source}" ${externalLink}>GitHub <span aria-hidden="true">↗</span></a></nav>
      <a class="button header-cta" href="${store}" ${externalLink}>Get it for Chrome <span aria-hidden="true">↗</span></a>
    </header>
    <main id="main">${content}</main>
    <footer class="site-footer wrap compare-footer">
      <div><a class="wordmark" href="/">feedbacks.</a><p>By <a href="https://softinator.ai" ${externalLink}>Softinator</a>. Built in the open.</p></div>
      <nav aria-label="Footer navigation"><a href="/compare/">All comparisons</a><a href="${source}" ${externalLink}>Source</a><a href="/privacy.html">Privacy</a></nav>
    </footer>
  </body>
</html>`;
}

const ours = {
  editing:
    "Pencil, shapes, text, highlighter, numbered steps, blur, redaction, stickers and movable local images. Copy annotated PNG pixels or download PNG, JPEG, WebP and multi-page PDF. Crop export changes local outputs only.",
  recording:
    "Record a short tab video in a separate recorder for up to five active minutes, with pause/resume and separate opt-in tab audio and microphone. Preview, visually trim or crop, then send. Recording is not session replay.",
  capture:
    "Capture visible or full-page screenshots, attach original evidence to element pins, and keep unsent points local until Send. Shared pins and individually resolved points stay linked to the team thread.",
  hosting:
    "Apache-2.0 backend, web app, extension, MCP and CLI. Run them with your PostgreSQL and private S3-compatible storage.",
  agents:
    "Scoped MCP access to the thread, replies, screenshot and owner-approved reviewer guidance. Expertise weights are advisory.",
  handoff:
    "Clarify requests in the thread. An optional GitHub App can create an Issue from a reviewed draft and sync verified open/closed status when a project opts in; an authorized maintainer or separately scoped agent can perform the handoff.",
};

const statusLabels = {
  yes: "✓",
  no: "No",
  unknown: "Not verified",
  paid: "Paid",
  partial: "Partial",
  required: "External",
  components: "Parts",
  manual: "Manual",
  agent: "Agent",
};

function matrixGroup(group, activeSlug) {
  const features = group.features;
  const entries = [{ slug: "feedbacks", name: "Feedbacks" }, ...comparisons];
  const header = features
    .map(([, label]) => `<th scope="col">${escape(label)}</th>`)
    .join("");
  const rows = entries
    .map((entry) => {
      const cells = features
        .map(([key, label]) => {
          const evidence = matrixRows[entry.slug]?.[key];
          if (!evidence) {
            return `<td class="matrix-unknown"><span aria-label="${escape(entry.name)}: ${escape(label)} not verified">Not verified</span></td>`;
          }
          const symbol = statusLabels[evidence.status];
          const value = evidence.status === "yes" ? "Confirmed" : symbol;
          const explanation = `${value}. Checked ${evidence.reviewed}.${evidence.detail ? ` ${evidence.detail}` : ""}`;
          return `<td class="matrix-${evidence.status}"><a href="${escape(evidence.url)}" ${externalLink} aria-label="${escape(entry.name)}: ${escape(label)}. ${escape(explanation)} Read source." title="${escape(explanation)} Read source for ${escape(entry.name)}: ${escape(label)}">${escape(symbol)}</a></td>`;
        })
        .join("");
      const name =
        entry.slug === "feedbacks"
          ? `<a href="/">Feedbacks</a>`
          : `<a href="/compare/${entry.slug}.html">${escape(entry.name)}</a>`;
      return `<tr${entry.slug === activeSlug ? ' class="matrix-active"' : ""}><th scope="row">${name}</th>${cells}</tr>`;
    })
    .join("");
  return `<section class="compare-matrix" id="matrix-${group.id}" aria-labelledby="matrix-${group.id}-heading">
    <div class="matrix-intro"><h2 id="matrix-${group.id}-heading">${escape(group.title)}</h2><p>${escape(group.description)}</p></div>
    <div class="matrix-controls" aria-label="Comparison table navigation"><p>Swipe or use the arrows to see every feature.</p><div><button type="button" class="matrix-prev" aria-label="Previous comparison columns" disabled>←</button><span class="matrix-position" aria-live="polite">Feature 1 of ${features.length}</span><button type="button" class="matrix-next" aria-label="Next comparison columns">→</button></div></div>
    <div class="matrix-scroll" role="region" aria-label="${escape(group.title)} comparison table" tabindex="0">
      <table style="--matrix-columns: ${features.length}"><caption>${escape(group.title)}: Feedbacks and ${comparisons.length} website feedback tools, compared by documented capability</caption><thead><tr><th scope="col">Tool</th>${header}</tr></thead><tbody>${rows}</tbody></table>
    </div>

  </section>`;
}

function matrix(activeSlug) {
  return `<div class="comparison-overview">
    <h2>Compare the details that matter.</h2>
    <p>${matrixFeatures.length} capabilities across ${matrixGroups.length} tables. Open a confirmed mark for its source and review date. “Not verified” means the available evidence does not establish that capability; it does not mean the tool lacks it.</p>
    <nav class="matrix-jump" aria-label="Feature categories">${matrixGroups.map((group) => `<a href="#matrix-${group.id}">${escape(group.title)}</a>`).join("")}</nav>
    <p class="matrix-key"><strong>✓</strong> Confirmed <span>·</span> <strong>No</strong> Explicitly unavailable <span>·</span> <strong>Not verified</strong> Evidence insufficient <span>·</span> <strong>Parts</strong> Components to assemble <span>·</span> <strong>External</strong> Required account <span>·</span> <strong>Paid</strong> Paid edition <span>·</span> <strong>Partial</strong> Some named formats confirmed</p>
    <p class="matrix-date">Latest review: ${matrixReviewed}. Official vendor sources were reviewed on this date; each sourced cell records its check. Vendor documentation describes available capabilities, which can depend on plan or setup. This is not a hands-on certification. Feedbacks describes the current source; installed and Store versions may differ. A tick does not imply identical workflows.</p>
    </div>${matrixGroups.map((group) => matrixGroup(group, activeSlug)).join("")}`;
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
        ${row("Editing & exports", ours.editing, entry.theirEditing ?? "See the annotation table above for confirmed tools and formats. Specific capabilities without supporting documentation are marked Not verified.")}
        ${row("Recording", ours.recording, entry.theirRecording ?? "See the recording table above. Video review, session replay, audio sources and recording edits are assessed separately; undocumented capabilities are Not verified.")}
        ${row("Hosting & source", ours.hosting, entry.theirHosting)}
        ${row("Coding agents", ours.agents, entry.theirAI)}
        ${row("Next step", ours.handoff, entry.theirHandoff)}
      </section>
      <aside class="compare-limits">
        <h2>What Feedbacks does today.</h2>
        <p>Feedbacks is an early 0.x product. Its optional GitHub App requires separate server configuration and repository installation; it creates an Issue only from a reviewed draft and syncs verified open/closed status only after project opt-in. Incoming feedback never creates Issues automatically. The extension can record a short tab video with a five-minute active limit and 40 MiB size limit. Tab audio and microphone are optional. Visual trimming and frame cropping run locally before Send. Feedbacks does not provide session replay or an AI model subscription. Full-page screenshots retain separate readable sections; the optional combined attachment can be scaled for server limits. Blur is visual softening; use Redact for private pixels. Crop export affects downloads and clipboard copies, not the shared screenshot. It also offers opt-in project surveys and NPS. Self-hosting has no Feedbacks license fee; you still pay for your server, database, storage and operations.</p>
        <p>Reviewer expertise belongs in owner-approved guidance. A private member note or profile field is not automatically shared with an ordinary agent. Guidance helps interpretation but never grants permissions or guarantees how a model will decide.</p>
      </aside>
      <div class="compare-actions"><a class="button primary" href="${store}" ${externalLink}>Get the Chrome extension</a><a href="${source}/blob/HEAD/docs/self-hosting.md" ${externalLink}>Self-host Feedbacks</a></div>
      <section class="compare-sources" aria-labelledby="compare-sources-heading">
        <h2 id="compare-sources-heading">Sources and scope.</h2>
        <p>Checked ${reviewed}. This is a comparison of published product documentation, not a hands-on certification of every plan or deployment. Features and plans can change.</p>
        ${entry.scopeNote ? `<p>${escape(entry.scopeNote)}</p>` : ""}
        <ul>
          <li><a href="${source}/blob/HEAD/docs/why-feedbacks.md" ${externalLink}>Feedbacks product boundaries</a></li>
          <li><a href="${source}/blob/HEAD/docs/extension.md" ${externalLink}>Feedbacks capture, editing and recording</a></li>
          <li><a href="${source}/blob/HEAD/docs/agents.md" ${externalLink}>Feedbacks agent context</a></li>
          <li><a href="${source}/blob/HEAD/docs/self-hosting.md" ${externalLink}>Feedbacks self-hosting</a></li>
          ${entry.sources.map(([label, url]) => `<li><a href="${escape(url)}" ${externalLink}>${escape(label)}</a></li>`).join("")}
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
      <p class="compare-index-intro">Some tools start with a widget. Some start with a recording or a canvas. Feedbacks combines screenshots, original evidence for each page pin, annotation and local exports, optional recordings, and a discussion your team and agent can follow on your own server.</p>
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
      <div class="compare-index-end"><p>Own the full stack. Keep the thread.</p><a class="button primary" href="${store}" ${externalLink}>Get the Chrome extension</a><a href="${source}" ${externalLink}>Explore the source</a></div>
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
