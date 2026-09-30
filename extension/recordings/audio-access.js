// Preferences do not grant browser or operating-system device access.
export function recordingDefaults(saved = {}) {
  return {
    ...saved,
    tabAudio: typeof saved.tabAudio === "boolean" ? saved.tabAudio : true,
    microphone: typeof saved.microphone === "boolean" ? saved.microphone : true,
  };
}

export async function microphonePermission(media = navigator) {
  try {
    const { state } = await media.permissions.query({ name: "microphone" });
    return ["granted", "prompt", "denied"].includes(state) ? state : "unknown";
  } catch {
    return "unknown";
  }
}

export const audioRecoveryCodes = new Set([
  "microphone-permission",
  "microphone-blocked",
  "microphone-missing",
  "microphone-busy",
  "microphone-unavailable",
  "tab-audio-missing",
]);

export function audioAccessError(code) {
  const messages = {
    "microphone-permission":
      "Microphone access is needed. Allow it in Feedbacks Settings, then return to the website and start recording again.",
    "microphone-blocked":
      "Microphone access was blocked or dismissed. Open Feedbacks Settings to allow it in Chrome and check your computer’s microphone permissions, then try again.",
    "microphone-missing":
      "No microphone audio is available. Connect a microphone and select it in Chrome’s microphone settings, or turn Microphone off in Feedbacks Settings.",
    "microphone-busy":
      "Chrome could not open the microphone. Check your computer’s microphone permissions and other apps using the device, then test it in Feedbacks Settings.",
    "microphone-unavailable":
      "The microphone could not be started. Test it in Feedbacks Settings, or turn Microphone off to record without it.",
    "tab-audio-missing":
      "Tab sound was not captured. Retry from the website tab, or turn Tab sound off in Feedbacks Settings. In Chrome’s tab picker, enable Share tab audio.",
  };
  return Object.assign(Error(messages[code] || messages["microphone-unavailable"]), {
    audioCode: code,
  });
}

// A hidden offscreen document cannot display the first microphone prompt.
export async function requireMicrophonePermission(media = navigator) {
  const permission = await microphonePermission(media);
  if (permission === "prompt") throw audioAccessError("microphone-permission");
  if (permission === "denied") throw audioAccessError("microphone-blocked");
}

export async function captureMicrophone(media = navigator) {
  let stream;
  try {
    stream = await media.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (!stream.getAudioTracks().some((track) => track.readyState !== "ended"))
      throw audioAccessError("microphone-missing");
    return stream;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (error.audioCode) throw error;
    const code = {
      NotAllowedError: "microphone-blocked",
      SecurityError: "microphone-blocked",
      NotFoundError: "microphone-missing",
      OverconstrainedError: "microphone-missing",
      NotReadableError: "microphone-busy",
      AbortError: "microphone-busy",
    }[error.name];
    throw audioAccessError(code || "microphone-unavailable");
  }
}

// Obtain consent in a visible extension page, then immediately release the device.
export async function testMicrophone(media = navigator) {
  const stream = await captureMicrophone(media);
  stream.getTracks().forEach((track) => track.stop());
}
