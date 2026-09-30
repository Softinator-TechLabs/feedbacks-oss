// USER-origin important rules outrank even inline author-important copy locks.
// The document marker exists only while ordinary page review is active.
const excluded =
  'input,textarea,select,button,label,summary,[role="button"],[draggable="true"],script,style,[hidden],[aria-hidden="true"],[contenteditable],[data-feedbacks-private],#feedbacks-review-root';
const selector = `html[data-feedbacks-text-selection="on"] :not(:is(${excluded})):not(:is(${excluded}) *)`;
const css = `${selector}{user-select:text!important;-webkit-user-select:text!important}`;
export async function removeSelectionStyles(tabId) {
  await chrome.scripting
    .removeCSS({ target: { tabId, allFrames: true }, css, origin: "USER" })
    .catch(() => {});
}
export async function installSelectionStyles(tabId) {
  const injection = { target: { tabId, allFrames: true }, css, origin: "USER" };
  // Repeated activation/frame loads should keep only one copy per document.
  await chrome.scripting.removeCSS(injection).catch(() => {});
  try {
    await chrome.scripting.insertCSS(injection);
  } catch {
    // activeTab can authorize the main page while an embedded origin is denied.
    await chrome.scripting.insertCSS({ ...injection, target: { tabId } });
  }
}
