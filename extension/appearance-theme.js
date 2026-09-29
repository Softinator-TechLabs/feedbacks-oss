// Extension pages share this preference without changing the reviewed website.
function applyExtensionTheme(value) {
  const theme = ["light", "dark"].includes(value) ? value : "system";
  document.documentElement.dataset.feedbacksTheme = theme;
  document.documentElement.style.colorScheme = theme === "system" ? "light dark" : theme;
}
chrome.storage.local.get("extensionTheme").then(({ extensionTheme }) => {
  applyExtensionTheme(extensionTheme);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.extensionTheme)
    applyExtensionTheme(changes.extensionTheme.newValue);
});
