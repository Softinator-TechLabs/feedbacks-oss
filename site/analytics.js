(() => {
  const configuration = document.currentScript?.dataset;
  const id = configuration?.gaId;
  if (
    !/^G-[A-Z0-9]{10}$/.test(id ?? "") ||
    location.protocol !== "https:" ||
    location.hostname !== configuration.gaHost ||
    window.__feedbacksPublicAnalytics
  )
    return;
  window.__feedbacksPublicAnalytics = true;

  const preferenceKey = "feedbacks-public-analytics-v1";
  const disabledKey = `ga-disable-${id}`;
  let started = false;
  let allowed = false;
  const lifetime = 180 * 24 * 60 * 60 * 1000;
  function readPreference() {
    try {
      const raw = localStorage.getItem(preferenceKey);
      if (!raw) return undefined;
      const saved = JSON.parse(raw);
      if (
        typeof saved?.allowed === "boolean" &&
        Number.isFinite(saved.updatedAt) &&
        saved.updatedAt <= Date.now() &&
        Date.now() - saved.updatedAt < lifetime
      )
        return saved.allowed;
      localStorage.removeItem(preferenceKey);
    } catch {
      // Storage can be unavailable. Keep the choice for this document only.
    }
    return undefined;
  }
  function clearAnalyticsCookies() {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (/^_ga(?:_|$)/.test(name))
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
    }
  }
  function applyPreference(next) {
    allowed = next === true;
    window[disabledKey] = !allowed;
    if (!allowed) {
      clearAnalyticsCookies();
      return;
    }
    if (started) return;
    started = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    // Use GA4's pageview/history measurement only. There is no second router hook.
    window.gtag("js", new Date());
    window.gtag("config", id, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: "none",
      cookie_expires: 90 * 24 * 60 * 60,
      cookie_update: false,
    });
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.append(tag);
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const preferences = element("button", "Cookie preferences", "site-cookie-preferences");
  preferences.type = "button";
  preferences.setAttribute("aria-expanded", "false");
  preferences.setAttribute("aria-controls", "site-cookie-notice");
  const notice = element("section", "", "site-cookie-notice");
  notice.id = "site-cookie-notice";
  notice.setAttribute("aria-label", "Website analytics preferences");
  const message = element(
    "p",
    "Allow optional Google Analytics cookies to help improve this public website? ",
  );
  const privacy = element("a", "Privacy");
  privacy.href = "/privacy.html";
  message.append(privacy);
  const actions = element("div", "", "site-cookie-actions");
  function showNotice(show, focus = false) {
    notice.hidden = !show;
    preferences.setAttribute("aria-expanded", String(show));
    if (focus) (show ? allow : preferences).focus();
  }
  function savePreference(next) {
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({ allowed: next, updatedAt: Date.now() }),
      );
    } catch {
      // The current page still honors the explicit choice if persistence is blocked.
    }
    applyPreference(next);
    showNotice(false, true);
  }
  const allow = element("button", "Allow analytics");
  allow.type = "button";
  allow.addEventListener("click", () => savePreference(true));
  const decline = element("button", "Decline");
  decline.type = "button";
  decline.addEventListener("click", () => savePreference(false));
  preferences.addEventListener("click", () => showNotice(notice.hidden, true));
  notice.addEventListener("keydown", (event) => {
    if (event.key === "Escape") showNotice(false, true);
  });
  actions.append(allow, decline);
  notice.append(message, actions);
  document.body.append(preferences, notice);
  const saved = readPreference();
  applyPreference(saved);
  showNotice(saved === undefined);
  window.addEventListener("storage", (event) => {
    if (event.key !== preferenceKey && event.key !== null) return;
    const next = readPreference();
    applyPreference(next);
    showNotice(next === undefined);
  });
})();
