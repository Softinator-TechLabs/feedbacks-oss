// The bridge is injected only after the reviewer opens Feedbacks on this tab.
// Events carry setup status, never credentials or a configurable server URL.
export function setServerInExtension(): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (event: Event) => {
      const status = (event as CustomEvent).detail;
      if (!["set", "ready", "unchanged", "unavailable"].includes(status)) return;
      clearTimeout(timer);
      window.removeEventListener("feedbacks:server-result", finish);
      if (status === "set" || status === "ready") resolve();
      else if (status === "unchanged")
        reject(
          new Error(
            "The extension already has a server or an address in progress. Open extension Settings to change it.",
          ),
        );
      else
        reject(
          new Error(
            "Open the pinned Feedbacks icon on this page again. For local HTTP, paste the address and enable the local-server option.",
          ),
        );
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener("feedbacks:server-result", finish);
      reject(
        new Error(
          "Open the pinned Feedbacks icon on this page to detect the server. If the address stays empty, update the extension or copy the URL below.",
        ),
      );
    }, 3500);
    window.addEventListener("feedbacks:server-result", finish);
    window.dispatchEvent(new Event("feedbacks:set-server"));
  });
}
