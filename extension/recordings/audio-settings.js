import {
  microphonePermission,
  testMicrophone,
  audioAccessError,
  audioRecoveryCodes,
} from "./audio-access.js";

export function createAudioSettings({
  document,
  chrome,
  media = navigator,
  url = location.href,
}) {
  const $ = (id) => document.getElementById(id);
  let busy = false;
  const message = (text, kind = "") => {
    $("audio-message").textContent = text;
    $("audio-message").dataset.kind = kind;
  };
  async function refresh() {
    if (busy) return;
    const permission = await microphonePermission(media);
    $("microphone-state").textContent = {
      granted:
        "Microphone permission allowed. Test the device before recording if needed.",
      prompt: "Microphone permission not yet granted. Chrome will ask when you allow it.",
      denied:
        "Microphone permission blocked. Allow Feedbacks in Chrome’s microphone settings, then check again.",
      unknown:
        "Microphone permission status unavailable. Use Allow microphone to check access.",
    }[permission];
    $("microphone-test").textContent =
      permission === "granted"
        ? "Test microphone"
        : permission === "denied"
          ? "Check microphone again"
          : "Allow microphone";
    if (permission === "denied") $("audio-help").open = true;
    return permission;
  }
  async function check() {
    if (busy) return;
    busy = true;
    $("microphone-test").disabled = true;
    message("Checking microphone… Choose Allow if Chrome asks.");
    try {
      await testMicrophone(media);
      message(
        "Microphone is available. Return to the website and start recording. The test has stopped; no audio was saved.",
        "success",
      );
    } catch (error) {
      message(error.message, "error");
      $("audio-help").open = true;
    } finally {
      busy = false;
      $("microphone-test").disabled = false;
      await refresh();
    }
  }
  $("microphone-origin").textContent = chrome.runtime.getURL("");
  $("microphone-test").onclick = () => void check();
  $("microphone-settings").onclick = () => {
    void chrome.tabs.create({ url: "chrome://settings/content/microphone" }).catch(() => {
      message(
        "Open Chrome → Settings → Privacy and security → Site settings → Microphone.",
        "error",
      );
    });
  };
  const ready = (async () => {
    const permission = await refresh();
    const issue = new URL(url).searchParams.get("audioIssue");
    if (!audioRecoveryCodes.has(issue)) return;
    message(audioAccessError(issue).message, "error");
    $("audio-help").open = true;
    if (issue === "microphone-permission" && ["prompt", "unknown"].includes(permission))
      await check();
  })();
  return { refresh, ready };
}
