export default {
  reviewed: "30 September 2026",
  scope:
    "Hosted MarkUp.io website/image/PDF/video review, full help inventory, Chrome capture, current plans and SDK/API services. Loom is counted explicitly as an external recording integration; uploaded-video review is separate. Inspected public review client SHA-256 1006f05ff1784c3f4b42721ae4d91ed486231f4cade0d7b04de4fea85ec0bf62.",
  summary:
    "Verified live page pins, per-comment screenshots, rich drawing, resolved threads and frame-timestamp reviews. CSV/JSON exports retain URLs rather than a self-contained archive. Recording is through Loom; some embedded-recorder/audio/export details remain unverified.",
  sources: [
    {
      url: "https://www.markup.io/",
      title: "Current MarkUp.io product overview",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/collections/14629865-markup",
      title: "Complete 65-article MarkUp help inventory",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      title: "Feedback workflow and per-comment screenshots",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12454599-actioning-feedback-on-a-markup",
      title: "Resolve and filter individual feedback",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12463822-markup-io-chrome-extension",
      title: "Chrome capture extension",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12454895-annotating-video-markups",
      title: "Uploaded video frame annotations",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12463770-markup-io-and-loom-integration",
      title: "Embedded Loom recording integration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12462059-exporting-markup-comments",
      title: "CSV/JSON export fields and supported formats",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12462045-commenting-on-pdf-text-in-markup",
      title: "Selected PDF-text comments",
      reviewed: "30 September 2026",
    },
    {
      url: "https://educate.ceros.com/en/articles/12454966-settings-in-a-markup",
      title: "Per-MarkUp controls",
      reviewed: "30 September 2026",
    },
    {
      url: "https://developer.markup.io/sdk/api-reference/",
      title: "Complete browser SDK service reference",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.markup.io/blog/how-to-draw-on-videos/",
      title: "Drawing, shapes and frame annotations",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.markup.io/pricing/",
      title: "Current MarkUp.io paid tiers",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.markup.io/terms-and-conditions/",
      title: "Ceros proprietary service terms",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.atlassian.com/loom/docs/loomsdk-faq/",
      title: "Official product capability reference",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.markup.io/blog/how-to-annotate-a-pdf/",
      title: "Official product capability reference",
      reviewed: "30 September 2026",
    },
    {
      url: "https://developer.markup.io/sdk/",
      title: "Official product capability reference",
      reviewed: "30 September 2026",
    },
    {
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      title: "Inspected public review client",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "yes",
      url: "https://educate.ceros.com/en/articles/12463822-markup-io-chrome-extension",
      reviewed: "30 September 2026",
      detail:
        "Chrome extension creates Website MarkUps and automatic comment screenshots.",
      basis: "documentation",
    },
    screenshots: {
      status: "yes",
      url: "https://educate.ceros.com/en/articles/12463822-markup-io-chrome-extension",
      reviewed: "30 September 2026",
      detail: "Automatically captures the website view for a comment.",
      basis: "documentation",
    },
    fullPage: {
      status: "unknown",
      url: "https://educate.ceros.com/en/articles/12463822-markup-io-chrome-extension",
      reviewed: "30 September 2026",
      detail:
        "Chrome capture creates live canvases with comment screenshots; the guide does not establish full-scroll capture or an explicit viewport-only restriction.",
      basis: "scope",
    },
    pins: {
      status: "yes",
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail: "Contextual pins on live pages and uploaded assets.",
      basis: "documentation",
    },
    originals: {
      status: "yes",
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail:
        "Screenshot retained with each website comment when Chrome extension is enabled.",
      basis: "documentation",
    },
    drafts: {
      status: "no",
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail: "Each pin is posted to the shared canvas; no local batch of unsent points.",
      basis: "scope",
    },
    resolved: {
      status: "yes",
      url: "https://educate.ceros.com/en/articles/12454599-actioning-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail: "Resolve and reopen each comment thread.",
      basis: "documentation",
    },
    reviewDefaults: {
      status: "partial",
      url: "https://educate.ceros.com/en/articles/12454966-settings-in-a-markup",
      reviewed: "30 September 2026",
      detail:
        "Per-canvas notification, visible-pin and screenshot settings; recording is delegated to Loom.",
      basis: "documentation",
    },
    textSuggestions: {
      status: "partial",
      url: "https://educate.ceros.com/en/articles/12462045-commenting-on-pdf-text-in-markup",
      reviewed: "30 September 2026",
      detail:
        "Selected PDF text can anchor comments; no structured original/replacement website-text field.",
      basis: "documentation",
    },
    drawing: {
      status: "yes",
      url: "https://www.markup.io/blog/how-to-draw-on-videos/",
      reviewed: "30 September 2026",
      detail: "Freehand drawing, shapes, arrows and contextual text comments.",
      basis: "documentation",
    },
    highlighter: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "30 September 2026",
      detail: "Current product explicitly advertises highlighting/markup tools.",
      basis: "documentation",
    },
    steps: {
      status: "no",
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected client defines exactly rectangle, ellipse, line, arrow, pencil and highlighter tools. Export registry is CSV/JSON plus original/converted media; clipboard actions copy links/text. It has no named screenshot-editor operation.",
      basis: "source",
    },
    blur: {
      status: "no",
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected client defines exactly rectangle, ellipse, line, arrow, pencil and highlighter tools. Export registry is CSV/JSON plus original/converted media; clipboard actions copy links/text. It has no named screenshot-editor operation.",
      basis: "source",
    },
    redact: {
      status: "no",
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected client defines exactly rectangle, ellipse, line, arrow, pencil and highlighter tools. Export registry is CSV/JSON plus original/converted media; clipboard actions copy links/text. It has no named screenshot-editor operation.",
      basis: "source",
    },
    stickers: {
      status: "no",
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected client defines exactly rectangle, ellipse, line, arrow, pencil and highlighter tools. Export registry is CSV/JSON plus original/converted media; clipboard actions copy links/text. It has no named screenshot-editor operation.",
      basis: "source",
    },
    localImages: {
      status: "no",
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected client defines exactly rectangle, ellipse, line, arrow, pencil and highlighter tools. Export registry is CSV/JSON plus original/converted media; clipboard actions copy links/text. It has no named screenshot-editor operation.",
      basis: "source",
    },
    cropExport: {
      status: "no",
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected client defines exactly rectangle, ellipse, line, arrow, pencil and highlighter tools. Export registry is CSV/JSON plus original/converted media; clipboard actions copy links/text. It has no named screenshot-editor operation.",
      basis: "source",
    },
    rasterExport: {
      status: "unknown",
      url: "https://educate.ceros.com/en/articles/12462059-exporting-markup-comments",
      reviewed: "30 September 2026",
      detail:
        "CSV/JSON export references screenshot URLs, but native annotated PNG/JPEG/WebP export coverage is not stated; help/tool inventory checked.",
      basis: "documentation",
    },
    pdfExport: {
      status: "no",
      url: "https://educate.ceros.com/en/articles/12462059-exporting-markup-comments",
      reviewed: "30 September 2026",
      detail:
        "Export menu explicitly offers CSV or JSON; reviewing PDFs is a separate input feature.",
      basis: "explicit",
    },
    clipboard: {
      status: "no",
      url: "https://app.markup.io/bundle.f3ef338faeea8dc8e0eb.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected client defines exactly rectangle, ellipse, line, arrow, pencil and highlighter tools. Export registry is CSV/JSON plus original/converted media; clipboard actions copy links/text. It has no named screenshot-editor operation.",
      basis: "source",
    },
    video: {
      status: "external",
      url: "https://educate.ceros.com/en/articles/12463770-markup-io-and-loom-integration",
      reviewed: "30 September 2026",
      detail: "Screen/face recording supplied by the embedded Loom integration.",
      basis: "documentation",
    },
    tabAudio: {
      status: "unknown",
      url: "https://support.atlassian.com/loom/docs/loomsdk-faq/",
      reviewed: "30 September 2026",
      detail:
        "Conflicting Loom SDK guides: FAQ allows single-tab audio; limitation article says no internal audio. Exact MarkUp embedded-recorder behavior remains uncertain.",
      basis: "documentation",
    },
    microphone: {
      status: "external",
      url: "https://www.markup.io/blog/how-to-annotate-a-pdf/",
      reviewed: "30 September 2026",
      detail:
        "Loom video comments provide verbal explanation; recording supplied by Loom.",
      basis: "documentation",
    },
    pauseVideo: {
      status: "external",
      url: "https://support.atlassian.com/loom/docs/loomsdk-faq/",
      reviewed: "30 September 2026",
      detail: "Embedded Loom Record SDK supports pause/resume mid-recording.",
      basis: "documentation",
    },
    trimVideo: {
      status: "no",
      url: "https://educate.ceros.com/en/articles/12454895-annotating-video-markups",
      reviewed: "30 September 2026",
      detail:
        "Native video controls scrub uploaded review files; no native visual trim editor.",
      basis: "scope",
    },
    cropVideo: {
      status: "no",
      url: "https://educate.ceros.com/en/articles/12454895-annotating-video-markups",
      reviewed: "30 September 2026",
      detail:
        "Native uploaded-video review player has no crop editor in its documented control inventory.",
      basis: "scope",
    },
    replay: {
      status: "no",
      url: "https://educate.ceros.com/en/collections/14629865-markup",
      reviewed: "30 September 2026",
      detail:
        "Live canvases/uploaded video review and Loom messages, rather than recorded DOM sessions.",
      basis: "scope",
    },
    timeline: {
      status: "partial",
      url: "https://educate.ceros.com/en/articles/12454895-annotating-video-markups",
      reviewed: "30 September 2026",
      detail:
        "Video playback and timestamp pins; no synchronized console/network diagnostics.",
      basis: "documentation",
    },
    frameAnnotations: {
      status: "yes",
      url: "https://educate.ceros.com/en/articles/12454895-annotating-video-markups",
      reviewed: "30 September 2026",
      detail: "Scrub to exact video frames and place timestamped comments.",
      basis: "documentation",
    },
    threadBundle: {
      status: "partial",
      url: "https://educate.ceros.com/en/articles/12462059-exporting-markup-comments",
      reviewed: "30 September 2026",
      detail:
        "CSV/JSON includes threads, attachments and screenshot URLs; does not embed media in a complete portable archive.",
      basis: "documentation",
    },
    diagnostics: {
      status: "no",
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail:
        "Website screenshot and browser/screen context; no console/network collection in comment capture.",
      basis: "scope",
    },
    discussion: {
      status: "yes",
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail: "Real-time pinned comments, replies and mentions.",
      basis: "documentation",
    },
    mcp: {
      status: "no",
      url: "https://developer.markup.io/sdk/api-reference/",
      reviewed: "30 September 2026",
      detail:
        "Audited native developer interfaces are REST/browser SDK services; no MCP transport/tool server.",
      basis: "scope",
    },
    agentContext: {
      status: "partial",
      url: "https://developer.markup.io/sdk/api-reference/",
      reviewed: "30 September 2026",
      detail:
        "Public API/SDK exposes pinned threads/context; no native MCP agent workflow.",
      basis: "documentation",
    },
    expertise: {
      status: "no",
      url: "https://developer.markup.io/sdk/api-reference/",
      reviewed: "30 September 2026",
      detail:
        "Complete SDK services are projects, threads, replies and uploads; no MCP reviewer/project/priority queue resources.",
      basis: "scope",
    },
    github: {
      status: "external",
      url: "https://educate.ceros.com/en/collections/14629865-markup",
      reviewed: "30 September 2026",
      detail:
        "Integrations inventory offers Zapier for issue-tracker routing; no native GitHub destination.",
      basis: "documentation",
    },
    multiRepo: {
      status: "external",
      url: "https://educate.ceros.com/en/collections/14629865-markup",
      reviewed: "30 September 2026",
      detail:
        "External Zapier/API routing, rather than native per-project GitHub repository configuration.",
      basis: "documentation",
    },
    projectContext: {
      status: "no",
      url: "https://developer.markup.io/sdk/api-reference/",
      reviewed: "30 September 2026",
      detail:
        "Complete SDK services are projects, threads, replies and uploads; no MCP reviewer/project/priority queue resources.",
      basis: "scope",
    },
    source: {
      status: "no",
      url: "https://www.markup.io/terms-and-conditions/",
      reviewed: "30 September 2026",
      detail:
        "Terms retain Ceros ownership and grant no license to underlying software code.",
      basis: "explicit",
    },
    selfHost: {
      status: "no",
      url: "https://www.markup.io/terms-and-conditions/",
      reviewed: "30 September 2026",
      detail:
        "Licensed access to the hosted Ceros service; no complete self-host deployment.",
      basis: "explicit",
    },
    independent: {
      status: "no",
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail:
        "Hosted workspace required; account-free guest comments depend on a MarkUp workspace.",
      basis: "documentation",
    },
    storage: {
      status: "no",
      url: "https://www.markup.io/pricing/",
      reviewed: "30 September 2026",
      detail: "Vendor-managed storage allowances, not no-fee self-hosted S3.",
      basis: "scope",
    },
    apacheLicense: {
      status: "no",
      url: "https://www.markup.io/terms-and-conditions/",
      reviewed: "30 September 2026",
      detail: "Ceros proprietary service terms; no Apache-2.0 complete-product grant.",
      basis: "explicit",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://www.markup.io/pricing/",
      reviewed: "30 September 2026",
      detail:
        "Current paid Pro/Business/Enterprise plans and limited trial; not all features without fees.",
      basis: "explicit",
    },
    multiApps: {
      status: "no",
      url: "https://educate.ceros.com/en/collections/14629865-markup",
      reviewed: "30 September 2026",
      detail:
        "No native multi-GitHub-App server configuration in the integration/deployment inventory.",
      basis: "scope",
    },
    agentQueue: {
      status: "no",
      url: "https://developer.markup.io/sdk/api-reference/",
      reviewed: "30 September 2026",
      detail:
        "Complete SDK services are projects, threads, replies and uploads; no MCP reviewer/project/priority queue resources.",
      basis: "scope",
    },
    sessionOnly: {
      status: "no",
      url: "https://educate.ceros.com/en/collections/14629865-markup",
      reviewed: "30 September 2026",
      detail:
        "No recorded DOM-session capture in the native website/asset review inventory.",
      basis: "scope",
    },
    screenshotDiagnostics: {
      status: "no",
      url: "https://educate.ceros.com/en/articles/12454641-leaving-feedback-on-a-markup",
      reviewed: "30 September 2026",
      detail:
        "Comment screenshot/browser context; no DOM+console+network diagnostic capture.",
      basis: "scope",
    },
    nativeClients: {
      status: "no",
      url: "https://developer.markup.io/sdk/",
      reviewed: "30 September 2026",
      detail:
        "Official SDK is JavaScript for web-page comments; not an Android/iOS feedback SDK.",
      basis: "scope",
    },
  },
};
