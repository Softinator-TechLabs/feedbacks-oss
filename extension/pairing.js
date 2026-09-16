// Persist the user intent before Chrome opens a permission prompt. The popup may
// close at that point; a background permission event must be able to finish it.
export function createPairingCoordinator({
  get,
  set,
  remove,
  contains,
  start,
  now = Date.now,
}) {
  let queue = Promise.resolve();
  const run = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function finish() {
    const { pairIntent } = await get();
    if (!pairIntent) return {};
    if (pairIntent.expiresAt <= now()) {
      await remove("pairIntent");
      return {};
    }
    if (!(await contains({ origins: [pairIntent.server + "/*"] }))) return {};
    try {
      await start(pairIntent);
      await remove("pairIntent");
      return {};
    } catch (error) {
      await set({ pairError: error.message });
      await remove("pairIntent");
      throw error;
    }
  }
  return {
    prepare(intent) {
      return run(async () => {
        await set({
          server: intent.server,
          serverDraft: intent.server,
          allowLocal: intent.allowLocal,
          pairIntent: { ...intent, expiresAt: now() + 120000 },
          pairError: "",
        });
        return finish();
      });
    },
    finish: () => run(finish),
    cancel(requestId) {
      return run(async () => {
        const { pairIntent } = await get();
        if (pairIntent?.requestId === requestId) await remove("pairIntent");
        return {};
      });
    },
  };
}
