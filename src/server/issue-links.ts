import { fail } from "./errors.js";

type ReportedIssue =
  | { provider: "github"; url: string; repository: string; number: number }
  | { provider: "jira"; url: string; issueKey: string }
  | { provider: "linear"; url: string; workspace: string; issueKey: string };

export function reportedIssue(value: string): ReportedIssue {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("VALIDATION", "Expected a canonical GitHub, Jira Cloud or Linear Issue URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port
  )
    fail("VALIDATION", "Expected a canonical GitHub, Jira Cloud or Linear Issue URL");

  const github = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/);
  if (url.origin === "https://github.com" && github)
    return {
      provider: "github",
      url: `https://github.com/${github[1]}/${github[2]}/issues/${github[3]}`,
      repository: `${github[1]}/${github[2]}`,
      number: Number(github[3]),
    };

  const jira = url.pathname.match(/^\/browse\/([A-Z][A-Z0-9_]*-[1-9]\d*)\/?$/);
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net$/.test(url.hostname) && jira)
    return {
      provider: "jira",
      url: `https://${url.hostname}/browse/${jira[1]}`,
      issueKey: jira[1],
    };

  const linear = url.pathname.match(
    /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/issue\/([A-Z][A-Z0-9]*-[1-9]\d*)(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?\/?$/,
  );
  if (url.origin === "https://linear.app" && linear)
    return {
      provider: "linear",
      url: `https://linear.app/${linear[1]}/issue/${linear[2]}${linear[3] ? `/${linear[3]}` : ""}`,
      workspace: linear[1],
      issueKey: linear[2],
    };

  fail("VALIDATION", "Expected a canonical GitHub, Jira Cloud or Linear Issue URL");
}
