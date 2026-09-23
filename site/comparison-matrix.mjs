// Each verdict links to the vendor's documentation or public source.
// A cross means the named capability is not in the documented product/edition
// reviewed here. It is not a claim about every private or future offering.
// An omitted cell means the evidence is insufficient for either verdict.
export const matrixReviewed = "23 September 2026";

export const matrixFeatures = [
  ["source", "Public server source"],
  ["selfHost", "Whole service self-hosted"],
  ["independent", "No required external account"],
  ["storage", "S3 in no-fee self-hosting"],
  ["extension", "Browser extension capture"],
  ["drawing", "Draw on screenshots"],
  ["mcp", "Feedback via MCP"],
  ["video", "Record feedback or replay"],
  ["github", "GitHub Issues handoff"],
  ["expertise", "Approved reviewer expertise for agents"],
];

const feedbacks =
  "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/why-feedbacks.md";
const hosting =
  "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/self-hosting.md";
const agent =
  "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/agents.md";
const yes = (url) => ({ status: "yes", url });
const note = (status, url) => ({ status, url });
const no = (url) => note("no", url);
const hosted = (url) => ({
  source: no(url),
  selfHost: no(url),
  independent: no(url),
  storage: no(url),
});

export const matrixRows = {
  feedbacks: {
    source: yes(feedbacks),
    selfHost: yes(hosting),
    independent: yes(feedbacks),
    storage: yes(hosting),
    extension: yes(feedbacks),
    drawing: yes(feedbacks),
    mcp: yes(agent),
    video: note("no", feedbacks),
    github: note("manual", feedbacks),
    expertise: yes(feedbacks),
  },
  bugpin: {
    source: yes("https://github.com/aranticlabs/bugpin"),
    selfHost: yes("https://bugpin.io/editions/"),
    independent: yes("https://bugpin.io/editions/"),
    storage: note("paid", "https://bugpin.io/editions/"),
    drawing: yes("https://bugpin.io/editions/"),
    github: yes("https://bugpin.io/editions/"),
    extension: no("https://github.com/aranticlabs/bugpin/tree/main/src/widget"),
    mcp: no("https://github.com/aranticlabs/bugpin/tree/main/src"),
    video: no("https://bugpin.io/editions/"),
  },
  fasterfixes: {
    source: yes("https://github.com/manucoffin/faster-fixes"),
    selfHost: yes("https://www.faster-fixes.com/docs/self-hosting"),
    independent: note("required", "https://www.faster-fixes.com/docs/self-hosting"),
    storage: yes("https://www.faster-fixes.com/docs/self-hosting"),
    mcp: yes("https://www.faster-fixes.com/docs/mcp/setup"),
    github: yes("https://www.faster-fixes.com/docs/self-hosting"),
    extension: no("https://www.faster-fixes.com/docs/concepts/how-it-works"),
    drawing: no("https://www.faster-fixes.com/docs/getting-started/quickstart"),
    video: no("https://www.faster-fixes.com/docs/concepts/how-it-works"),
  },
  siteping: {
    source: yes("https://github.com/NeosiaNexus/SitePing"),
    selfHost: note(
      "components",
      "https://github.com/NeosiaNexus/SitePing/blob/main/apps/demo/content/docs/index.mdx",
    ),
    independent: yes(
      "https://github.com/NeosiaNexus/SitePing/blob/main/apps/demo/content/docs/adapters/localstorage.mdx",
    ),
    storage: note(
      "components",
      "https://github.com/NeosiaNexus/SitePing/blob/main/apps/demo/content/docs/adapters/prisma.mdx",
    ),
    extension: no("https://github.com/NeosiaNexus/SitePing/tree/main/packages"),
    drawing: no(
      "https://github.com/NeosiaNexus/SitePing/blob/main/apps/demo/content/docs/index.mdx",
    ),
    mcp: no("https://github.com/NeosiaNexus/SitePing/tree/main/packages"),
    video: no("https://github.com/NeosiaNexus/SitePing/tree/main/packages"),
    github: no("https://github.com/NeosiaNexus/SitePing/tree/main/packages"),
  },
  openreplay: {
    source: yes("https://github.com/openreplay/openreplay"),
    selfHost: yes("https://github.com/openreplay/openreplay"),
    independent: yes("https://docs.openreplay.com/en/deployment/"),
    storage: yes("https://docs.openreplay.com/en/configuration/external-storage/"),
    extension: yes("https://docs.openreplay.com/en/spot/"),
    mcp: yes("https://docs.openreplay.com/en/mcp/setup/"),
    video: yes("https://docs.openreplay.com/en/spot/"),
    drawing: no("https://docs.openreplay.com/en/spot/"),
    github: yes("https://docs.openreplay.com/en/integrations/github/"),
  },
  bugherd: {
    ...hosted("https://bugherd.com/pricing"),
    extension: yes(
      "https://support.bugherd.com/en/articles/11424451-bugherd-browser-extensions",
    ),
    mcp: yes("https://bugherd.com/feature/mcp"),
    video: yes("https://bugherd.com/blog/record-website"),
    github: yes(
      "https://support.bugherd.com/en/articles/11430519-bugherd-and-github-integration",
    ),
    drawing: yes("https://bugherd.com/website-annotation-tool"),
  },
  "marker-io": {
    ...hosted("https://marker.io/website-annotation-tool"),
    extension: yes("https://help.marker.io/en/articles/6495644-browser-extensions"),
    drawing: yes(
      "https://help.marker.io/en/articles/5546520-how-to-integrate-marker-io-into-your-web-app",
    ),
    mcp: yes(
      "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
    ),
    video: yes("https://marker.io/features/session-replay"),
    github: yes(
      "https://help.marker.io/en/articles/5546520-how-to-integrate-marker-io-into-your-web-app",
    ),
  },
  "markup-io": {
    ...hosted("https://www.markup.io/"),
    extension: yes("https://www.markup.io/blog/how-to-annotate-on-google-chrome/"),
    drawing: yes("https://www.markup.io/"),
    video: no("https://www.markup.io/"),
  },
  "markup-hero": {
    ...hosted("https://markuphero.com/"),
    extension: yes("https://markuphero.com/integrations/chrome-extension.html"),
    drawing: yes("https://markuphero.com/integrations/chrome-extension.html"),
    video: no("https://markuphero.com/"),
  },
  "redpen-ai": {
    ...hosted("https://www.redpen.ai/getting-started"),
    extension: yes("https://www.redpen.ai/getting-started"),
    drawing: yes("https://www.redpen.ai/getting-started"),
    video: yes("https://www.redpen.ai/getting-started"),
    github: yes("https://www.redpen.ai/getting-started"),
  },
  pastel: {
    ...hosted(
      "https://help.usepastel.com/en/articles/16399951-connecting-pastel-to-cursor",
    ),
    extension: yes(
      "https://help.usepastel.com/en/articles/8168731-pastel-chrome-extension",
    ),
    drawing: no("https://usepastel.com/website-annotation-tool"),
    video: no("https://usepastel.com/website-annotation-tool"),
    mcp: yes(
      "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
    ),
  },
  ruttl: {
    ...hosted("https://www.ruttl.com/"),
    extension: yes("https://site.dev.ruttl.com/chrome-extension/"),
    drawing: yes("https://site.dev.ruttl.com/chrome-extension/"),
    mcp: yes("https://www.ruttl.com/mcp"),
    video: yes("https://www.ruttl.com/blog/video-feedback-record-website"),
  },
  superflow: {
    ...hosted("https://usesuperflow.ai/pricing"),
    extension: no("https://usesuperflow.ai/screenshots"),
    drawing: no("https://usesuperflow.ai/screenshots"),
    mcp: no("https://usesuperflow.ai/tools/mcp"),
    video: yes("https://usesuperflow.ai/recordings"),
    github: no("https://usesuperflow.ai/integrations"),
  },
  usersnap: {
    ...hosted("https://wf.usersnap.com/pricing"),
    extension: yes("https://help.usersnap.com/docs/track-browser-extensions"),
    drawing: yes("https://usersnap.com/quality-assurance"),
    mcp: yes("https://usersnap.com/integrations/mcp"),
    video: yes("https://help.usersnap.com/docs/feedback-with-a-screen-recording"),
    github: yes("https://help.usersnap.com/docs/github"),
  },
  userback: {
    ...hosted("https://userback.io/pricing/"),
    extension: yes("https://userback.io/feature/browser-extension/"),
    drawing: yes(
      "https://support.userback.io/en/articles/5322214-installing-the-userback-browser-extension",
    ),
    mcp: yes("https://docs.userback.io/docs/welcome"),
    video: yes("https://support.userback.io/en/articles/15268500-video-feedback"),
    github: yes("https://userback.io/integration/github/"),
  },
  atarim: {
    ...hosted("https://atarim.io/pricing/"),
    extension: yes(
      "https://atarim.io/help/visual-collaboration/how-to-use-the-annotation-tools-for-feedback-in-atarim/",
    ),
    drawing: yes(
      "https://atarim.io/help/visual-collaboration/how-to-use-the-annotation-tools-for-feedback-in-atarim/",
    ),
    mcp: yes("https://atarim.io/mcp/"),
  },
};
