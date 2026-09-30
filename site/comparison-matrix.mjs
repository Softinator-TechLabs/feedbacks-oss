// Canonical dated evidence. No verdict is inferred from a missing keyword.
import feedbacks from "./comparison-evidence/feedbacks.mjs";
import audit0 from "./comparison-evidence/bugpin.mjs";
import audit1 from "./comparison-evidence/fasterfixes.mjs";
import audit2 from "./comparison-evidence/siteping.mjs";
import audit3 from "./comparison-evidence/openreplay.mjs";
import audit4 from "./comparison-evidence/bugherd.mjs";
import audit5 from "./comparison-evidence/marker-io.mjs";
import audit6 from "./comparison-evidence/markup-io.mjs";
import audit7 from "./comparison-evidence/markup-hero.mjs";
import audit8 from "./comparison-evidence/redpen-ai.mjs";
import audit9 from "./comparison-evidence/pastel.mjs";
import audit10 from "./comparison-evidence/ruttl.mjs";
import audit11 from "./comparison-evidence/superflow.mjs";
import audit12 from "./comparison-evidence/usersnap.mjs";
import audit13 from "./comparison-evidence/userback.mjs";
import audit14 from "./comparison-evidence/atarim.mjs";

export const matrixReviewed = "30 September 2026";
export const matrixGroups = [
  {
    id: "highlights",
    title: "Distinctive Feedbacks workflows",
    description:
      "Compare the complete product, portable evidence and team-aware agent handoff. A distinctive combination does not mean every capability is exclusive.",
    features: [
      ["apacheLicense", "Apache-2.0 licensed complete product"],
      ["allFeaturesFree", "All product features without a license fee"],
      ["threadBundle", "Portable complete thread archive"],
      ["expertise", "Owner-approved weighted reviewer guidance in MCP"],
      ["projectContext", "Versioned project guidance for agents"],
      ["multiApps", "Multiple GitHub Apps on one server"],
      ["agentQueue", "Assigned and prioritized task queue through MCP"],
      ["sessionOnly", "Session capture without recording video"],
      ["screenshotDiagnostics", "DOM, console and network bundle with screenshots"],
      ["textSuggestions", "Selected text and replacement suggestions"],
      ["timeline", "Shared playback and diagnostic timeline"],
      ["frameAnnotations", "Timestamped frame annotations"],
    ],
  },
  {
    id: "capture",
    title: "Capture and page review",
    description:
      "Keep the page, the selected element and its original evidence together.",
    features: [
      ["extension", "Browser extension capture"],
      ["screenshots", "Screenshot capture"],
      ["fullPage", "Full-page capture"],
      ["pins", "Element or page pins"],
      ["originals", "Original screenshot per review point"],
      ["drafts", "Local multi-point review-and-send queue"],
      ["resolved", "Resolve individual points"],
      ["reviewDefaults", "Saved review and recording controls"],
    ],
  },
  {
    id: "annotation",
    title: "Annotation and image exports",
    description:
      "Compare specific editing tools and output formats, not just an annotation checkbox.",
    features: [
      ["drawing", "Draw, shapes and text"],
      ["highlighter", "Highlighter"],
      ["steps", "Numbered steps"],
      ["blur", "Blur tool"],
      ["redact", "Mask private pixels"],
      ["stickers", "Stamps or stickers"],
      ["localImages", "Insert, move and resize local images"],
      ["cropExport", "Crop screenshot exports"],
      ["rasterExport", "PNG, JPEG and WebP export"],
      ["pdfExport", "Multi-page PDF export"],
      ["clipboard", "Copy annotated image"],
    ],
  },
  {
    id: "recording",
    title: "Recording and diagnostics",
    description:
      "Recording a new clip and replaying a past session are different capabilities.",
    features: [
      ["video", "Record feedback video"],
      ["tabAudio", "Capture tab audio"],
      ["microphone", "Microphone narration"],
      ["pauseVideo", "Pause and resume recording"],
      ["trimVideo", "Trim video visually"],
      ["cropVideo", "Crop video frame"],
      ["replay", "Session replay"],
      ["diagnostics", "Console or network context"],
    ],
  },
  {
    id: "collaboration",
    title: "Team discussion and agent handoff",
    description: "Check how reviewers, developers and authorized agents share the work.",
    features: [
      ["discussion", "Team comments and replies"],
      ["mcp", "Feedback via MCP"],
      ["agentContext", "Visual or page context for agents"],
      ["github", "GitHub Issues handoff"],
      ["multiRepo", "Multiple GitHub repositories per project"],
      ["nativeClients", "Native mobile feedback SDKs"],
    ],
  },
  {
    id: "hosting",
    title: "Source and self-hosting",
    description: "Availability in a hosted plan does not establish self-hosting support.",
    features: [
      ["source", "Public server source"],
      ["selfHost", "Whole service self-hosted"],
      ["independent", "No required external account"],
      ["storage", "S3 in no-fee self-hosting"],
    ],
  },
];
export const matrixFeatures = matrixGroups.flatMap((group) => group.features);
export const feedbacksAudit = feedbacks;
export const vendorAudits = {
  bugpin: audit0,
  fasterfixes: audit1,
  siteping: audit2,
  openreplay: audit3,
  bugherd: audit4,
  "marker-io": audit5,
  "markup-io": audit6,
  "markup-hero": audit7,
  "redpen-ai": audit8,
  pastel: audit9,
  ruttl: audit10,
  superflow: audit11,
  usersnap: audit12,
  userback: audit13,
  atarim: audit14,
};
export const matrixRows = {
  feedbacks: feedbacks.cells,
  ...Object.fromEntries(
    Object.entries(vendorAudits).map(([slug, audit]) => [slug, audit.cells]),
  ),
};
