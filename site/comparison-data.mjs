// Comparison products and current Feedbacks workflows. Dated matrix verdicts live in comparison-evidence/.
// Current Feedbacks workflows are separate from the historical competitor audit.
export const feedbacksCurrentRelease = {
  reviewed: "22 October 2026",
  sourceRevision: "6387b8d61971edaf75063aaeb6478a73f41542c5",
  capabilities: [
    {
      label: "Kanban boards",
      detail: "Custom columns, drag-and-drop and batch assignment.",
      guide: "/docs/reference/manual/project-board",
      sourcePath: "docs/project-board.md",
    },
    {
      label: "Project analytics",
      detail: "Pending, overdue and high-priority work, trends and drilldowns.",
      guide: "/docs/reference/manual/analytics",
      sourcePath: "docs/analytics.md",
    },
    {
      label: "Email & templates",
      detail:
        "Subscribed feedback and discussion emails; server and project templates. Mailjet, Amazon SES and Google/custom SMTP.",
      guide: "/docs/reference/manual/email-notifications",
      sourcePath: "docs/email-notifications.md",
    },
    {
      label: "10 task integrations",
      detail:
        "Named destination pickers and reviewed task handoff. Provider credentials or configured Jira OAuth are required.",
      guide: "/docs/reference/manual/integrations",
      sourcePath: "docs/integrations.md",
    },
  ],
  taskProviders: [
    "Jira Cloud",
    "Linear",
    "Asana",
    "ClickUp",
    "monday.com",
    "Trello",
    "Productive",
    "Teamwork",
    "Firmao CRM",
    "OpenProject",
  ],
};
export const comparisons = [
  {
    slug: "bugpin",
    name: "BugPin",
    group: "Open source",
  },
  {
    slug: "fasterfixes",
    name: "FasterFixes",
    group: "Open source",
  },
  {
    slug: "siteping",
    name: "SitePing",
    group: "Open source",
  },
  {
    slug: "openreplay",
    name: "OpenReplay + Spot",
    group: "Open source",
  },
  {
    slug: "bugherd",
    name: "BugHerd",
    group: "Hosted tools",
  },
  {
    slug: "marker-io",
    name: "Marker.io",
    group: "Hosted tools",
  },
  {
    slug: "markup-io",
    name: "MarkUp.io",
    group: "Hosted tools",
  },
  {
    slug: "markup-hero",
    name: "Markup Hero",
    group: "Hosted tools",
  },
  {
    slug: "redpen-ai",
    name: "Redpen.ai",
    group: "Hosted tools",
  },
  {
    slug: "pastel",
    name: "Pastel",
    group: "Hosted tools",
  },
  {
    slug: "ruttl",
    name: "Ruttl",
    group: "Hosted tools",
  },
  {
    slug: "superflow",
    name: "Superflow",
    group: "Hosted tools",
  },
  {
    slug: "usersnap",
    name: "Usersnap",
    group: "Hosted tools",
  },
  {
    slug: "userback",
    name: "Userback",
    group: "Hosted tools",
  },
  {
    slug: "atarim",
    name: "Atarim",
    group: "Hosted tools",
  },
];
