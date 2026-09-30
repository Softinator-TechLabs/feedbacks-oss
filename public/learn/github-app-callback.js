"use strict";
(async () => {
  const callback = document.getElementById("github-app-callback");
  const input = { state: callback?.dataset.state, code: callback?.dataset.code };
  if (callback) {
    delete callback.dataset.state;
    delete callback.dataset.code;
  }
  // Remove the one-time values before issuing further requests or rendering the app.
  history.replaceState(null, "", "/github-apps");
  const post = async (operation, body, csrf) => {
    const response = await fetch(`/api/${operation}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error("Setup failed");
    return payload.data;
  };
  try {
    const complete = async () => {
      const session = await post("auth.me", {});
      return post("github.appSetupComplete", input, session.csrf);
    };
    const app = navigator.locks
      ? await navigator.locks.request("feedbacks-session-request", complete)
      : await complete();
    location.replace(`/github-apps?setup=connected&appId=${encodeURIComponent(app.id)}`);
  } catch {
    location.replace("/github-apps?setup=failed");
  }
})();
