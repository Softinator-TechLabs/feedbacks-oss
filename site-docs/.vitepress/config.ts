import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Feedbacks Docs",
  description:
    "Capture, discuss and resolve website feedback with your team and coding agents.",
  lang: "en-US",
  base: "/docs/",
  cleanUrls: true,
  outDir: "../dist/site/docs",
  lastUpdated: true,
  sitemap: { hostname: "https://feedbacks.softinator.ai" },
  head: [
    ["meta", { name: "theme-color", content: "#12243b" }],
    ["link", { rel: "icon", href: "/docs/favicon.svg" }],
  ],
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "Feedbacks",
    nav: [
      { text: "Start", link: "/guide/getting-started" },
      { text: "Use Feedbacks", link: "/guide/review-feedback" },
      { text: "Developers", link: "/guide/self-host" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Overview", link: "/" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Capture and review", link: "/guide/review-feedback" },
          { text: "Chrome extension", link: "/guide/chrome-extension" },
        ],
      },
      {
        text: "Connect your tools",
        items: [
          { text: "AI agents and MCP", link: "/guide/mcp" },
          { text: "GitHub Issues", link: "/guide/github" },
          { text: "API and CLI", link: "/reference/api-cli" },
        ],
      },
      {
        text: "Operate",
        items: [
          { text: "Self-host", link: "/guide/self-host" },
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
      message: "Documentation for the open-source Feedbacks app.",
      copyright: "© Softinator TechLabs",
    },
  },
});
