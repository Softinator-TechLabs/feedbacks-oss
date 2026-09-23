// Each positive or qualified claim links to first-party documentation.
// An omitted cell means "not verified", never "does not exist".
export const matrixReviewed = "23 September 2026";

export const matrixFeatures = [
  ["source", "Public server source"],
  ["selfHost", "Whole service self-hosted"],
  ["independent", "No required external account"],
  ["storage", "S3 in no-fee self-hosting"],
  ["extension", "Browser extension capture"],
  ["drawing", "Draw on screenshots"],
  ["mcp", "MCP for agents"],
  ["video", "Recording or session replay"],
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
  },
  fasterfixes: {
    source: yes("https://github.com/manucoffin/faster-fixes"),
    selfHost: yes("https://www.faster-fixes.com/docs/self-hosting"),
    independent: note("required", "https://www.faster-fixes.com/docs/self-hosting"),
    storage: yes("https://www.faster-fixes.com/docs/self-hosting"),
    mcp: yes("https://www.faster-fixes.com/docs/mcp/setup"),
    github: yes("https://www.faster-fixes.com/docs/self-hosting"),
  },
  siteping: {
    source: yes("https://github.com/NeosiaNexus/SitePing"),
    selfHost: note(
      "components",
      "https://github.com/NeosiaNexus/SitePing/blob/main/apps/demo/content/docs/index.mdx",
    ),
  },
  openreplay: {
    source: yes("https://github.com/openreplay/openreplay"),
    selfHost: yes("https://github.com/openreplay/openreplay"),
    extension: yes("https://docs.openreplay.com/en/spot/"),
    mcp: yes("https://docs.openreplay.com/en/mcp/setup/"),
    video: yes("https://docs.openreplay.com/en/spot/"),
  },
  bugherd: {
    extension: yes(
      "https://support.bugherd.com/en/articles/11424451-bugherd-browser-extensions",
    ),
    mcp: yes("https://bugherd.com/feature/mcp"),
    video: yes("https://bugherd.com/blog/record-website"),
    github: yes(
      "https://support.bugherd.com/en/articles/11430519-bugherd-and-github-integration",
    ),
  },
  "marker-io": {
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
    extension: yes("https://www.markup.io/blog/how-to-annotate-on-google-chrome/"),
    drawing: yes("https://www.markup.io/"),
  },
  "markup-hero": {
    extension: yes("https://markuphero.com/integrations/chrome-extension.html"),
    drawing: yes("https://markuphero.com/integrations/chrome-extension.html"),
  },
  "redpen-ai": {
    extension: yes("https://www.redpen.ai/getting-started"),
    drawing: yes("https://www.redpen.ai/getting-started"),
    video: yes("https://www.redpen.ai/getting-started"),
    github: yes("https://www.redpen.ai/getting-started"),
  },
  pastel: {
    mcp: yes(
      "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
    ),
  },
  ruttl: {
    mcp: yes("https://www.ruttl.com/mcp"),
    video: yes("https://www.ruttl.com/blog/video-feedback-record-website"),
  },
  superflow: {
    video: yes("https://usesuperflow.ai/recordings"),
  },
  usersnap: {
    drawing: yes("https://usersnap.com/quality-assurance"),
    mcp: yes("https://usersnap.com/integrations/mcp"),
    video: yes("https://help.usersnap.com/docs/feedback-with-a-screen-recording"),
  },
  userback: {
    extension: yes("https://userback.io/feature/browser-extension/"),
    drawing: yes(
      "https://support.userback.io/en/articles/5322214-installing-the-userback-browser-extension",
    ),
    mcp: yes("https://docs.userback.io/docs/welcome"),
    video: yes("https://support.userback.io/en/articles/15268500-video-feedback"),
  },
  atarim: {
    extension: yes(
      "https://atarim.io/help/visual-collaboration/how-to-use-the-annotation-tools-for-feedback-in-atarim/",
    ),
    drawing: yes(
      "https://atarim.io/help/visual-collaboration/how-to-use-the-annotation-tools-for-feedback-in-atarim/",
    ),
    mcp: yes("https://atarim.io/mcp/"),
  },
};
