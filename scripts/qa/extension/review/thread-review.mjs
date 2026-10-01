import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyThreadReview({
  context,
  auth,
  access,
  inlineThread,
  inlineThreadId,
  root,
  results,
}) {
  const cookieSplit = auth.cookie.indexOf("=");
  const cookieName = auth.cookie.slice(0, cookieSplit);
  const cookieValue = auth.cookie.slice(cookieSplit + 1);
  await context.addCookies([
    { name: cookieName, value: cookieValue, url: access.url, sameSite: "Strict" },
  ]);
  // Cross-site links must enter the web app first: Strict cookies are omitted
  // on the top-level navigation, then sent on the app's same-site API requests.
  const linkedOriginal = inlineThread.assets.find(
    (asset) => asset.filename === "point-002-original.webp",
  );
  assert.ok(linkedOriginal);
  const crossSite = await context.newPage();
  await crossSite.goto("https://example.com/");
  const assetLink = `${access.url}/threads/${inlineThreadId}#asset-${linkedOriginal.id}`;
  await crossSite.evaluate((href) => {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.textContent = "Open feedback image";
    document.body.prepend(link);
  }, assetLink);
  const linkedPagePromise = context.waitForEvent("page");
  await crossSite.getByRole("link", { name: "Open feedback image" }).click();
  const linkedPage = await linkedPagePromise;
  await linkedPage.bringToFront();
  await linkedPage
    .locator(`.review-point-figure[id="asset-${linkedOriginal.id}"]`)
    .waitFor();
  await linkedPage
    .waitForFunction((id) => {
      const img = document.getElementById(`asset-${id}`)?.querySelector("img");
      return img?.complete && img.naturalWidth > 0;
    }, linkedOriginal.id)
    .catch(async (error) => {
      console.error(
        "Linked point image diagnostics",
        await linkedPage.evaluate((id) => {
          const figure = document.getElementById(`asset-${id}`);
          const img = figure?.querySelector("img");
          return {
            hash: location.hash,
            open: figure?.closest("details")?.open,
            image: img && {
              src: img.getAttribute("src"),
              complete: img.complete,
              width: img.naturalWidth,
              bounds: img.getBoundingClientRect().toJSON(),
            },
            figure: figure?.getBoundingClientRect().toJSON(),
          };
        }, linkedOriginal.id),
      );
      throw error;
    });
  assert.equal(
    await linkedPage.getByRole("button", { name: "Sign in", exact: true }).count(),
    0,
  );
  results.githubAssetLink = {
    existingSessionReused: true,
    selectedOriginal: true,
    imageLoaded: true,
  };
  await linkedPage.close();
  await crossSite.close();
  const inlineThreadPage = await context.newPage();
  await inlineThreadPage.goto(`${access.url}/threads/${inlineThreadId}`);
  await inlineThreadPage.getByRole("heading", { name: "Review on the page" }).waitFor();
  await inlineThreadPage.getByRole("combobox", { name: "Assigned member" }).waitFor();
  await inlineThreadPage.getByRole("group", { name: "Feedback actions" }).waitFor();
  await inlineThreadPage.getByRole("button", { name: "Archive thread" }).waitFor();
  await inlineThreadPage.getByRole("combobox", { name: "Status" }).waitFor();
  await inlineThreadPage.getByRole("button", { name: "Copy task for agent" }).waitFor();
  await inlineThreadPage
    .getByRole("button", { name: "Create a guest discussion link" })
    .waitFor();
  for (const width of [900, 1200, 1351, 1440]) {
    await inlineThreadPage.setViewportSize({ width, height: 800 });
    const headerLayout = await inlineThreadPage
      .locator(".thread-header-actions")
      .evaluate((bar) => ({
        rows: new Set(
          [...bar.children]
            .filter((child) => child.getBoundingClientRect().width > 0)
            .map((child) => Math.round(child.getBoundingClientRect().top)),
        ).size,
        overflow: bar.scrollWidth > bar.clientWidth + 1,
      }));
    assert.equal(
      headerLayout.rows,
      1,
      `thread actions should occupy one row at ${width}px`,
    );
    assert.equal(
      headerLayout.overflow,
      false,
      `thread actions should not overflow at ${width}px`,
    );
  }
  await inlineThreadPage.setViewportSize({ width: 900, height: 650 });
  await inlineThreadPage.getByRole("button", { name: "Expand all", exact: true }).click();
  const openPoint = inlineThreadPage.locator(".review-point-list li.open").first();
  await openPoint.getByLabel("Point 2 timing").selectOption("today");
  await inlineThreadPage
    .locator('.thread-heading-meta .point-progress-ring[aria-label*="1 urgent"]')
    .waitFor();
  await openPoint.getByLabel("Point 2 priority").selectOption("high");
  await openPoint.getByText("High priority", { exact: true }).waitFor();
  await inlineThreadPage.reload();
  await inlineThreadPage.getByRole("button", { name: "Expand all", exact: true }).click();
  const plannedPoint = inlineThreadPage.locator(".review-point-list li.open").first();
  assert.equal(await plannedPoint.getByLabel("Point 2 priority").inputValue(), "high");
  assert.equal(await plannedPoint.getByLabel("Point 2 timing").inputValue(), "today");
  const progressList = await context.newPage();
  await progressList.goto(`${access.url}/projects/${inlineThread.projectId}`);
  const progressRow = progressList.locator(
    `.thread-row:has(a[href^="/threads/${inlineThreadId}"])`,
  );
  await progressRow
    .getByText("1 of 2 points resolved · 1 open", { exact: true })
    .waitFor();
  const remainingPoint = progressRow.locator(".thread-point-status-list li").filter({
    hasText: "#2",
  });
  await remainingPoint.getByText("Open", { exact: true }).waitFor();
  await progressRow.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-progress-list.png"),
  });
  await progressList.close();
  assert.equal(await inlineThreadPage.locator(".review-main-capture").count(), 1);
  assert.equal(await inlineThreadPage.locator(".review-point-figure").count(), 2);
  const mainImage = inlineThreadPage.locator(".review-main-capture");
  assert.equal(await mainImage.locator(".review-image-pin").count(), 2);
  await mainImage.getByRole("button", { name: "Review image", exact: true }).click();
  const expanded = inlineThreadPage.getByRole("dialog");
  await expanded.getByRole("button", { name: "Hide points" }).click();
  assert.equal(await mainImage.locator(".review-image-pin").count(), 0);
  assert.equal(
    await inlineThreadPage.locator(".review-point-figure .review-image-pin").count(),
    2,
    "hiding one screenshot must not hide pins in other screenshots",
  );
  assert.equal(
    await inlineThreadPage
      .locator('.review-point-figure .review-image-pin[data-style="ring"]')
      .count(),
    2,
  );
  assert.equal(
    await inlineThreadPage
      .locator(".review-point-figure .review-image-pin")
      .first()
      .textContent(),
    "",
    "a point's own screenshot uses an unnumbered target ring",
  );
  await expanded.getByRole("button", { name: "Show points" }).click();
  assert.equal(
    await mainImage.locator(".review-image-open .review-image-pin").count(),
    2,
  );
  await expanded.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(
    await inlineThreadPage.getByRole("button", { name: "Show original view" }).count(),
    0,
  );
  await inlineThreadPage.waitForFunction(() =>
    [
      ...document.querySelectorAll(".review-main-capture img, .review-point-figure img"),
    ].every((image) => image.complete && image.naturalWidth > 0),
  );
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-desktop.png"),
    fullPage: true,
  });
  await inlineThreadPage.getByRole("button", { name: "Switch to dark mode" }).click();
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-dark-desktop.png"),
    fullPage: true,
  });
  await inlineThreadPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await inlineThreadPage.locator(".review-point-figure").count(), 2);
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-dark-mobile.png"),
    fullPage: true,
  });
  await inlineThreadPage.getByRole("button", { name: "Switch to light mode" }).click();
  await inlineThreadPage
    .getByRole("button", { name: "Resolve point", exact: true })
    .click();
  await inlineThreadPage
    .getByRole("status")
    .filter({ hasText: "Point resolved." })
    .waitFor();
  assert.equal(
    await inlineThreadPage
      .getByRole("button", { name: "Reopen point", exact: true })
      .count(),
    2,
  );
  await inlineThreadPage
    .getByRole("button", { name: "Remove point", exact: true })
    .last()
    .click();
  await inlineThreadPage
    .getByRole("status")
    .filter({ hasText: "Point removed." })
    .waitFor();
  await inlineThreadPage.getByLabel("Filter points").selectOption("removed");
  await inlineThreadPage
    .getByRole("button", { name: "Restore point", exact: true })
    .click();
  await inlineThreadPage
    .getByRole("status")
    .filter({ hasText: "Point reopened." })
    .waitFor();
  await inlineThreadPage.getByLabel("Filter points").selectOption("all");
  assert.equal(
    await inlineThreadPage
      .getByRole("button", { name: "Resolve point", exact: true })
      .count(),
    1,
  );
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-mobile.png"),
  });
  results.inlineReview.inlinePointImages = 2;
  results.inlineReview.mobilePointSelection = true;
}
