// Uploads stay in the review page. Switching tabs must not navigate that page
// until every selected attachment has been confirmed by the server.
export function createReviewNavigation({
  sourceTabId,
  chromeApi = chrome,
  navigate = (url) => location.assign(url),
}) {
  let reviewTab;
  let background = false;
  async function focus(tab) {
    await chromeApi.windows.update(tab.windowId, { focused: true });
    await chromeApi.tabs.update(tab.id, { active: true });
  }
  return {
    async begin(mode) {
      background = mode === "background";
      if (!background) return;
      reviewTab = await chromeApi.tabs.getCurrent();
      if (!reviewTab || reviewTab.id === sourceTabId())
        throw Error("The review tab is unavailable. Choose Send & Open.");
      let source;
      try {
        source = await chromeApi.tabs.get(sourceTabId());
      } catch {
        throw Error("The website tab is closed. Choose Send & Open.");
      }
      await focus(source);
    },
    async complete(url) {
      if (background) await chromeApi.tabs.remove(reviewTab.id);
      else navigate(url);
    },
    async recover() {
      if (background && reviewTab) await focus(reviewTab).catch(() => {});
    },
  };
}
