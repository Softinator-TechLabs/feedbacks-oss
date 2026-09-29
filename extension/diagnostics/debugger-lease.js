// One Chrome debugger attachment per tab, shared by recording and screenshot traces.
export function createDebuggerLease(chrome) {
  const entries = new Map();
  chrome.debugger.onDetach.addListener((source) => {
    entries.delete(source.tabId);
  });
  async function acquire(tabId, owner) {
    let entry = entries.get(tabId);
    if (entry?.closing) {
      await entry.closing.catch(() => {});
      return acquire(tabId, owner);
    }
    if (!entry) {
      entry = { owners: new Set(), opening: null, closing: null };
      entries.set(tabId, entry);
      entry.opening = chrome.debugger.attach({ tabId }, "1.3");
    }
    entry.owners.add(owner);
    try {
      await entry.opening;
    } catch (error) {
      if (entries.get(tabId) === entry) entries.delete(tabId);
      throw error;
    }
  }
  async function release(tabId, owner) {
    const entry = entries.get(tabId);
    if (!entry?.owners.delete(owner) || entry.owners.size || entry.closing) return;
    entry.closing = (async () => {
      await entry.opening;
      await chrome.debugger.detach({ tabId });
    })();
    try {
      await entry.closing;
    } finally {
      if (entries.get(tabId) === entry) entries.delete(tabId);
    }
  }
  return {
    acquire,
    release,
    hasOwner: (tabId, owner) => entries.get(tabId)?.owners.has(owner) === true,
  };
}
