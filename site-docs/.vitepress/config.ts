import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Feedbacks Docs",
  description:
    "Free Apache-2.0 visual feedback, session replay, debugging bundles and AI-agent context. Install and use the complete self-hosted product.",
  lang: "en-US",
  base: "/docs/",
  cleanUrls: true,
  outDir: "../dist/site/docs",
  sitemap: { hostname: "https://feedbacks.softinator.ai" },
  head: [
    ["script", { src: "/learn/demo.js?v=20260930-6", defer: "" }],
    ["meta", { name: "theme-color", content: "#fffdfa" }],
    [
      "meta",
      {
        property: "og:image",
        content: "https://feedbacks.softinator.ai/media/social-preview.png",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["link", { rel: "icon", href: "/docs/favicon.svg" }],
  ],
  transformHead({ pageData }) {
    const path = pageData.relativePath.replace(/(?:index)?\.md$/, "");
    const canonical = `https://feedbacks.softinator.ai/docs/${path}`;
    return [
      ["link", { rel: "canonical", href: canonical }],
      ["meta", { property: "og:url", content: canonical }],
      ["meta", { property: "og:title", content: `${pageData.title} | Feedbacks` }],
      [
        "meta",
        {
          property: "og:description",
          content:
            pageData.description ||
            "Free, self-hosted visual feedback and debugging evidence.",
        },
      ],
      ["meta", { property: "og:type", content: "article" }],
    ];
  },
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "Feedbacks",
    nav: [
      { text: "Start", link: "/guide/getting-started" },
      { text: "Use Feedbacks", link: "/guide/review-feedback" },
      { text: "DevOps installation", link: "/guide/self-host" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Overview", link: "/" },
          { text: "Complete setup flow", link: "/guide/getting-started" },
          { text: "Clients: leave feedback", link: "/guide/clients" },
          { text: "Owner: projects and people", link: "/guide/team-setup" },
          { text: "Capture and review", link: "/guide/review-feedback" },
          { text: "Install, pin and send", link: "/guide/chrome-extension" },
        ],
      },
      {
        text: "Capture the whole story",
        items: [
          { text: "Video and session replay", link: "/guide/session-replay" },
          { text: "Debugging bundles", link: "/guide/debug-bundles" },
          { text: "Exact text suggestions", link: "/guide/text-suggestions" },
          { text: "Project and agent context", link: "/guide/agent-context" },
          { text: "More ways to review", link: "/guide/more-ways-to-review" },
        ],
      },
      {
        text: "Connect your tools",
        items: [
          { text: "Developers: AI agents and MCP", link: "/guide/mcp" },
          { text: "GitHub Issues", link: "/guide/github" },
          { text: "API and CLI", link: "/reference/api-cli" },
          { text: "Comparison audit method", link: "/reference/comparison-method" },
        ],
      },
      {
        text: "Operate",
        items: [
          { text: "DevOps: install the server", link: "/guide/self-host" },
          { text: "Production configuration", link: "/reference/manual/self-hosting" },
          { text: "Operations & recovery", link: "/reference/manual/operations" },
          { text: "Access and privacy", link: "/guide/access-privacy" },
          { text: "Troubleshooting", link: "/guide/troubleshooting" },
        ],
      },
    ],
    search: { provider: "local" },
    editLink: {
      pattern:
        "https://github.com/Softinator-TechLabs/feedbacks-oss/edit/main/site-docs/:path",
      text: "Improve this page",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/Softinator-TechLabs/feedbacks-oss" },
    ],
    footer: {
      message: "Feedbacks documentation. Built in the open.",
      copyright: "© Softinator TechLabs",
    },
  },
});
