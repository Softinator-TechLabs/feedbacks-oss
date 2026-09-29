import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyGithubToolbar({
  context,
  access,
  seriesThreadId,
  seriesThread,
  root,
  results,
}) {
  // GitHub toolbar states use local API fixtures; no GitHub writes are made.
  const githubPage = await context.newPage();
  let githubConfigured = true,
    githubMultiple = false,
    githubLinked = false,
    githubPending = false;
  const githubCreates = [];
  const repositories = ["https://github.com/demo/web", "https://github.com/demo/api"];
  await githubPage.route(`${access.url}/api/**`, async (route) => {
    const operation = route.request().url().split("/").at(-1);
    let data;
    if (operation === "github.connection")
      data = {
        configured: githubConfigured,
        installation: githubConfigured ? "installed" : "not_configured",
        repositories: (githubMultiple ? repositories : repositories.slice(0, 1)).map(
          (repositoryUrl) => ({
            repositoryUrl,
            connected: true,
            installation: "installed",
          }),
        ),
      };
    else if (operation === "github.issueState")
      data = {
        status: githubPending ? "pending" : githubLinked ? "linked" : "none",
        issueUrl: githubLinked ? `${repositories[0]}/issues/1` : null,
        canAbandon: false,
      };
    else if (operation === "github.issueCreateQuick") {
      githubCreates.push(route.request().postDataJSON());
      githubLinked = true;
      data = seriesThread;
    } else if (operation === "projects.get") {
      const response = await route.fetch();
      const body = await response.json();
      body.data.githubConnected = true;
      return route.fulfill({ json: body });
    } else return route.continue();
    await route.fulfill({ json: { ok: true, data } });
  });
  await githubPage.goto(`${access.url}/threads/${seriesThreadId}`);
  await githubPage
    .getByRole("button", { name: "Create GitHub issue", exact: true })
    .waitFor();
  assert.equal(await githubPage.locator(".github-issue-control").isVisible(), false);
  await githubPage.screenshot({
    path: join(root, ".local/finalize-qa/github-toolbar.png"),
  });
  await githubPage
    .getByRole("button", { name: "Create GitHub issue", exact: true })
    .click();
  await githubPage
    .getByRole("button", { name: "View GitHub issue", exact: true })
    .waitFor();
  assert.equal(githubCreates.length, 1);
  assert.equal(githubCreates[0].repositoryUrl, repositories[0]);
  await githubPage
    .getByRole("button", { name: "View GitHub issue", exact: true })
    .click();
  await githubPage.getByRole("dialog", { name: "GitHub issue", exact: true }).waitFor();
  await githubPage.keyboard.press("Escape");
  githubConfigured = false;
  githubLinked = false;
  await githubPage.reload();
  await githubPage
    .getByRole("button", { name: "View or link issues", exact: true })
    .click();
  await githubPage.locator("#thread-issues[open]").waitFor();
  assert.equal(githubCreates.length, 1);
  githubConfigured = true;
  githubMultiple = true;
  await githubPage.reload();
  await githubPage
    .getByRole("button", { name: "Create GitHub issue", exact: true })
    .click();
  await githubPage
    .getByRole("combobox", { name: /Create Issue in/ })
    .selectOption(repositories[1]);
  assert.equal(githubCreates.length, 1);
  await githubPage.getByRole("button", { name: "Create Issue", exact: true }).click();
  await githubPage.getByRole("link", { name: "Open GitHub Issue" }).waitFor();
  assert.equal(githubCreates.length, 2);
  assert.equal(githubCreates[1].repositoryUrl, repositories[1]);
  githubPending = true;
  githubLinked = false;
  await githubPage.reload();
  await githubPage
    .getByText("The last Issue request may have succeeded.", { exact: false })
    .waitFor();
  assert.equal(githubCreates.length, 2, "Uncertain requests must never create again");
  await githubPage.setViewportSize({ width: 320, height: 720 });
  assert.equal(
    await githubPage
      .locator("dialog[open]")
      .evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    true,
  );
  await githubPage.screenshot({
    path: join(root, ".local/finalize-qa/github-pending-mobile.png"),
  });
  await githubPage.close();
  results.githubToolbar = {
    singleRepositoryQuickCreate: true,
    noPersistentBanner: true,
    manualFallback: true,
    multipleRepositories: true,
    pendingRecovery: true,
  };
}
