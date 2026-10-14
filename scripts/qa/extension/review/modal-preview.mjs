import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyModalPreview({
  page,
  fixture,
  toFixture,
  exposeReviewRoot,
  send,
  id,
  worker,
  waitReview,
  results,
  root,
}) {
  fixture.mode = "short";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "modal-preview";
    dialog.style.cssText = "width:80vw;height:65vh;transform:scale(.9);overflow:hidden";
    const frame = document.createElement("iframe");
    frame.title = "Modal preview";
    frame.style.cssText = "width:100%;height:90%";
    frame.srcdoc = "<h1>Synthetic embedded preview</h1><p>Modal review copy</p>";
    dialog.append(frame);
    document.body.append(dialog);
    dialog.showModal();
  });
  await page
    .frameLocator("#modal-preview iframe")
    .getByRole("heading")
    .click({ button: "right" });
  await waitReview((state) => state.ready && state.frozen);
  const inspect = (save = false) =>
    worker.evaluate(
      async ({ tabId, save }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (save) => {
            const root = globalThis.__feedbacksQaRoot;
            const field = root.querySelector(".point-menu textarea");
            if (save) {
              [...root.querySelectorAll(".point-menu button")]
                .find((b) => b.textContent === "Save point")
                .click();
              return;
            }
            field.focus();
            return {
              focused: root.activeElement === field,
              parent: root.host.parentElement.id,
              popover: root.host.matches(":popover-open"),
              value: field.value,
            };
          },
          args: [save],
        });
        return entry.result;
      },
      { tabId: id, save },
    );
  const state = await inspect();
  assert.equal(
    state.focused,
    true,
    "Packaged comment must receive focus inside the site's modal",
  );
  assert.equal(state.parent, "modal-preview");
  assert.equal(state.popover, true);
  await page.keyboard.type("Synthetic packaged modal point");
  assert.equal((await inspect()).value, "Synthetic packaged modal point");
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/modal-preview.png"),
  });
  await inspect(true);
  await waitReview((state) => state.points === 1);
  await page.locator("#modal-preview").evaluate((dialog) => dialog.close());
  await send({ type: "discard" });
  results.modalPreview = { interactiveComment: true, savedPoint: true };
}
