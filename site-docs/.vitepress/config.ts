import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Feedbacks Docs",
  description:
    "Install Feedbacks for your team, capture UI feedback and give AI coding agents the context to fix it.",
  lang: "en-US",
  base: "/docs/",
  cleanUrls: true,
  outDir: "../dist/site/docs",
  sitemap: { hostname: "https://feedbacks.softinator.ai" },
  head: [
    ["script", { src: "/learn/demo.js", defer: "" }],
    ["meta", { name: "theme-color", content: "#12243b" }],
    ["link", { rel: "icon", href: "/docs/favicon.svg" }],
  ],
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
        text: "Connect your tools",
        items: [
          { text: "Developers: AI agents and MCP", link: "/guide/mcp" },
          { text: "GitHub Issues", link: "/guide/github" },
          { text: "API and CLI", link: "/reference/api-cli" },
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
      message: "Documentation for the open-source Feedbacks app.",
      copyright: "© Softinator TechLabs",
    },
  },
});
