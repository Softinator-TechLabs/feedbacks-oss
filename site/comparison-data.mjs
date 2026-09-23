// Evidence-backed copy for the public comparison pages. Keep claims tied to the
// linked vendor documentation and update the reviewed date when rechecking it.
export const reviewed = "23 September 2026";

export const comparisons = [
  {
    slug: "bugpin",
    name: "BugPin",
    group: "Open source",
    summary:
      "Two self-hosted visual feedback tools with different capture and storage choices.",
    theirCapture:
      "An embeddable widget captures screenshots, annotations, diagnostics and offline reports.",
    theirHosting:
      "Community is free and self-hosted with local image storage. S3 storage is listed under Enterprise. Server and admin are AGPL-3.0; the widget is MIT.",
    theirAI:
      "Exports diagnostics as Markdown, JSON or an AI prompt. The cited product pages focus on reporting and export.",
    theirHandoff: "Community includes direct GitHub issue creation.",
    bestFor:
      "Choose BugPin if an embedded widget and direct GitHub issue creation suit your review flow.",
    feedbacksBest:
      "Choose Feedbacks if you want a browser extension without adding a widget to each site, MCP discussions and private S3-compatible storage in the Apache-2.0 release.",
    sources: [
      ["BugPin editions", "https://bugpin.io/editions/"],
      ["BugPin source and feature guide", "https://github.com/aranticlabs/bugpin"],
    ],
  },
  {
    slug: "fasterfixes",
    name: "FasterFixes",
    group: "Open source",
    summary:
      "Both can put visual feedback in an agent's hands. Their deployment paths differ.",
    theirCapture:
      "A website widget captures page, screenshot, selector and browser context.",
    theirHosting:
      "The AGPL-3.0 application can be self-hosted. Its published production guide requires Inngest and a transactional email provider alongside PostgreSQL and object storage.",
    theirAI: "Its MCP server lets agents read feedback and update status.",
    theirHandoff: "Its GitHub integration can create issues automatically.",
    bestFor:
      "Choose FasterFixes if you want a site widget and automatic GitHub issue creation, and its documented services fit your deployment.",
    feedbacksBest:
      "Choose Feedbacks if you prefer extension capture, threaded discussion and a complete self-hosted deployment without a required external job or email account.",
    sources: [
      ["FasterFixes source", "https://github.com/manucoffin/faster-fixes"],
      [
        "FasterFixes self-hosting guide",
        "https://www.faster-fixes.com/docs/self-hosting",
      ],
    ],
  },
  {
    slug: "siteping",
    name: "SitePing",
    group: "Open source",
    summary:
      "A drop-in website widget and a separate review workspace solve different setup problems.",
    theirCapture:
      "A widget pins rectangle or right-click comments to page elements, with optional screenshots and diagnostics.",
    theirHosting:
      "MIT-licensed packages run against your database through a server adapter in the site you build.",
    theirAI: "Its documented interfaces include a dashboard, HTTP API and CLI.",
    theirHandoff: "The dashboard and adapter keep triage close to the website project.",
    bestFor:
      "Choose SitePing if you want to embed a lightweight widget into a site you control and adapt the storage layer yourself.",
    feedbacksBest:
      "Choose Feedbacks if reviewers need to capture different websites through a Chrome extension and discuss them in one deployable application with MCP.",
    sources: [
      ["SitePing repository and docs", "https://github.com/NeosiaNexus/SitePing"],
    ],
  },
  {
    slug: "openreplay",
    name: "OpenReplay + Spot",
    group: "Open source",
    summary:
      "A replay-led bug report and a marked screenshot preserve different kinds of evidence.",
    theirCapture:
      "Spot records a browser tab or desktop and produces a video report with actions, console and network context.",
    theirHosting:
      "Spot is available with OpenReplay's open-source, self-hosted platform.",
    theirAI:
      "The cited Spot guide centers on recording and sharing technical bug context.",
    theirHandoff: "Recordings are shared with a team for reproduction and investigation.",
    bestFor:
      "Choose OpenReplay + Spot when reproducing a sequence of user actions is the main job.",
    feedbacksBest:
      "Choose Feedbacks when a specific screenshot, pencil mark and continuing team discussion are the main record your agent should read.",
    sources: [
      ["OpenReplay source", "https://github.com/openreplay/openreplay"],
      ["Spot documentation", "https://docs.openreplay.com/en/spot/"],
    ],
  },
  {
    slug: "bugherd",
    name: "BugHerd",
    group: "Hosted tools",
    summary:
      "Both make website feedback visible. The difference is where the product runs and when work becomes a task.",
    theirCapture:
      "A widget or Chrome extension pins feedback and collects screenshots and technical details.",
    theirHosting:
      "BugHerd offers subscription plans with hosted projects, file reviews and an integrated task board.",
    theirAI: "Its current plans include MCP and AI features.",
    theirHandoff:
      "Feedback enters a Kanban board and can integrate with GitHub and other task tools.",
    bestFor:
      "Choose BugHerd for a ready hosted board, guest reviews and feedback on websites, Figma files, PDFs and images.",
    feedbacksBest:
      "Choose Feedbacks when you want to run the entire service yourself and clarify quick requests in threads before deciding which belong in GitHub Issues.",
    sources: [
      ["BugHerd features", "https://bugherd.com/features"],
      ["BugHerd plans and MCP", "https://bugherd.com/pricing"],
    ],
  },
  {
    slug: "marker-io",
    name: "Marker.io",
    group: "Hosted tools",
    summary:
      "Marker.io routes feedback into existing task systems; Feedbacks keeps the first discussion in your own workspace.",
    theirCapture:
      "A website widget or browser extension collects annotated screenshots and technical context.",
    theirHosting:
      "Its documented workflow uses Marker.io projects, a hosted widget and connected task tools.",
    theirAI: "Marker.io has published MCP support and agent workflows.",
    theirHandoff: "Integrations send reports to tools such as Jira, Linear and GitHub.",
    bestFor:
      "Choose Marker.io when automatic routing into an established issue tracker is the priority.",
    feedbacksBest:
      "Choose Feedbacks for a deployable Apache-2.0 backend, S3 storage you control and owner-approved reviewer guidance alongside MCP threads.",
    sources: [
      [
        "Marker.io widget and integrations",
        "https://marker.io/features/website-feedback-widget",
      ],
      ["Marker.io product updates", "https://feedback.marker.io/changelog"],
    ],
  },
  {
    slug: "markup-io",
    name: "MarkUp.io",
    group: "Hosted tools",
    summary:
      "MarkUp spans creative formats. Feedbacks is built around website review and agent-readable discussion.",
    theirCapture:
      "Reviewers can pin comments and annotate websites, videos, PDFs and images.",
    theirHosting:
      "MarkUp presents a hosted review workspace with shareable links and guest collaborators.",
    theirAI: "Its product page emphasizes contextual feedback and creative review.",
    theirHandoff: "Comments and review rounds stay with each MarkUp.",
    bestFor:
      "Choose MarkUp.io when your team reviews video, PDFs, images and websites in one creative workflow.",
    feedbacksBest:
      "Choose Feedbacks when the website screenshot, threaded decisions and MCP context belong on your own server.",
    sources: [["MarkUp.io product", "https://www.markup.io/"]],
  },
  {
    slug: "markup-hero",
    name: "Markup Hero",
    group: "Hosted tools",
    summary:
      "Quick screenshot annotation and an ongoing team review workspace serve different moments.",
    theirCapture:
      "Capture screenshots or upload images and PDFs, then annotate and share a link.",
    theirHosting: "Markup Hero provides its screenshot application and sharing service.",
    theirAI: "The cited product page focuses on capture, annotation and sharing.",
    theirHandoff:
      "A shareable markup link can travel through email, chat or other tools.",
    bestFor: "Choose Markup Hero when you need a fast annotated image to share anywhere.",
    feedbacksBest:
      "Choose Feedbacks when each mark needs a project thread, named discussion, status and MCP context on your server.",
    sources: [["Markup Hero product", "https://markuphero.com/"]],
  },
  {
    slug: "redpen-ai",
    name: "Redpen.ai",
    group: "Hosted tools",
    summary:
      "Two browser-based ways to report a website issue, with different ownership of the review record.",
    scopeNote:
      "This page covers the current product at redpen.ai. The older design-review service at redpen.io is a different product.",
    theirCapture:
      "Its extension captures screenshots or video; reviewers can annotate reports and share them with a team.",
    theirHosting:
      "The cited Redpen.ai product uses an account and connected issue tracking services. It describes a hosted workflow.",
    theirAI:
      "The cited guides focus on capturing actionable reports and sending them to a tracker.",
    theirHandoff: "Its site lists Jira, Azure DevOps and GitHub Issues integrations.",
    bestFor:
      "Choose Redpen.ai when screenshot or recording capture should feed an existing issue tracker.",
    feedbacksBest:
      "Choose Feedbacks when the whole review application, screenshot storage, discussion and MCP endpoint must run on your infrastructure.",
    sources: [
      ["Redpen.ai product", "https://www.redpen.ai/"],
      ["Redpen.ai getting started", "https://www.redpen.ai/getting-started"],
    ],
  },
  {
    slug: "pastel",
    name: "Pastel",
    group: "Hosted tools",
    summary:
      "Both connect feedback to coding agents. Pastel organizes canvases; Feedbacks provides a self-hosted team slate.",
    theirCapture:
      "Pastel creates a canvas from a website URL and supports live comments, labels and responsive review.",
    theirHosting:
      "Its agent connection uses Pastel's hosted MCP endpoint and a Pastel account.",
    theirAI: "Its MCP lets authorized agents read and act on canvas comments.",
    theirHandoff: "Pastel can export comments into other task tools.",
    bestFor:
      "Choose Pastel for shareable canvases, guest approvals and feedback across websites and other creative files.",
    feedbacksBest:
      "Choose Feedbacks for extension capture and a complete open-source stack with approved reviewer expertise included in the agent's context.",
    sources: [
      ["Pastel product", "https://usepastel.com/"],
      [
        "Pastel MCP guide",
        "https://help.usepastel.com/en/articles/16400000-connecting-pastel-to-any-ai-agent",
      ],
    ],
  },
  {
    slug: "ruttl",
    name: "Ruttl",
    group: "Hosted tools",
    summary:
      "Ruttl covers several design surfaces. Feedbacks concentrates on the website conversation and its agent context.",
    theirCapture: "Ruttl collects comments on websites, mobile apps, images and PDFs.",
    theirHosting:
      "Its product site offers a hosted workspace and integrations with task services.",
    theirAI: "Ruttl also advertises an MCP connection for AI tools.",
    theirHandoff:
      "Teams can assign and prioritize tickets and connect task integrations.",
    bestFor:
      "Choose Ruttl when live site changes or feedback across mobile apps and documents are central.",
    feedbacksBest:
      "Choose Feedbacks when your team wants a fully self-hosted website review service and advisory reviewer guidance for MCP clients.",
    sources: [
      ["Ruttl product", "https://www.ruttl.com/"],
      ["Ruttl MCP", "https://www.ruttl.com/mcp"],
    ],
  },
  {
    slug: "superflow",
    name: "Superflow",
    group: "Hosted tools",
    summary:
      "Superflow puts collaboration on the site. Feedbacks makes the captured thread portable to your own server.",
    theirCapture:
      "An on-site review layer supports area and text comments plus audio and video notes.",
    theirHosting:
      "Its workflow uses a hosted Superflow project and a site-installed review layer.",
    theirAI: "Its published materials describe AI categorization and copy assistance.",
    theirHandoff: "Comments can be assigned, prioritized and managed on a board.",
    bestFor:
      "Choose Superflow for live on-site reviews, recordings and team task management.",
    feedbacksBest:
      "Choose Feedbacks for browser extension capture across sites, an Apache-2.0 server and MCP access to the complete discussion.",
    sources: [
      ["Superflow demo", "https://demo.usesuperflow.com/"],
      [
        "Superflow annotation guide",
        "https://usesuperflow.com/blog/how-to-annotate-a-website-in-5-simple-steps",
      ],
    ],
  },
  {
    slug: "usersnap",
    name: "Usersnap",
    group: "Hosted tools",
    summary:
      "Usersnap collects many kinds of product evidence. Feedbacks keeps visual website review focused.",
    theirCapture:
      "Widgets collect screenshots, recordings, device context and targeted survey responses.",
    theirHosting: "Usersnap provides a hosted feedback platform and integrations.",
    theirAI:
      "Its current site includes AI-assisted feedback analysis and MCP-enabled workflows.",
    theirHandoff: "Feedback can reach connected tools such as Jira.",
    bestFor:
      "Choose Usersnap when surveys, sentiment and product research sit alongside visual bug reports.",
    feedbacksBest:
      "Choose Feedbacks when you need screenshot-and-pencil discussions, self-hosted storage and an agent view of who said what.",
    sources: [
      ["Usersnap features", "https://usersnap.com/features"],
      ["Usersnap widget guide", "https://help.usersnap.com/docs/feedback-widget"],
      ["Usersnap MCP connector", "https://usersnap.com/integrations/mcp"],
    ],
  },
  {
    slug: "userback",
    name: "Userback",
    group: "Hosted tools",
    summary:
      "Both provide visual reports and MCP. Userback also runs a broad product feedback loop.",
    theirCapture:
      "A widget or browser extension captures annotated screenshots, recordings and bug context.",
    theirHosting:
      "Userback offers a hosted workspace with plans, portals and survey tools.",
    theirAI: "Userback lists an MCP server for agent workflows.",
    theirHandoff: "Two-way integrations can sync work with Jira, Linear and ClickUp.",
    bestFor:
      "Choose Userback for surveys, a public ideas portal, roadmap and synchronized product feedback.",
    feedbacksBest:
      "Choose Feedbacks when you want the whole review stack and private object storage under your control, with review discussion before project tracking.",
    sources: [
      ["Userback product", "https://userback.io/"],
      ["Userback feature reference", "https://userback.io/ai-info/"],
    ],
  },
  {
    slug: "atarim",
    name: "Atarim",
    group: "Hosted tools",
    summary:
      "Atarim connects client requests to site work. Feedbacks keeps the review evidence in an open stack.",
    theirCapture:
      "Reviewers can pin website comments with screenshots and discuss tasks in context.",
    theirHosting:
      "Atarim provides a workspace and a WordPress plugin for deeper site actions.",
    theirAI:
      "Its MCP connects Claude and Codex to tasks and can act on connected WordPress sites.",
    theirHandoff: "Requests become assigned tasks within Atarim's agency workflow.",
    bestFor:
      "Choose Atarim if your agency manages WordPress sites and wants agent-assisted changes inside that ecosystem.",
    feedbacksBest:
      "Choose Feedbacks when you want a standalone, self-hosted visual review app for web pages and advisory expertise in MCP context.",
    sources: [
      ["Atarim visual collaboration", "https://atarim.io/help/visual-collaboration/"],
      ["Atarim MCP", "https://atarim.io/mcp/"],
    ],
  },
];
