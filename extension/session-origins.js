import { captureOrigins } from "./session-capture.js";
export async function prepareCaptureOrigins(target, input) {
  const source = target.origin || new URL(target.url).origin;
  const origins = captureOrigins(source, input);
  const extra = origins
    .filter((origin) => origin !== source)
    .map((origin) => `${origin}/*`);
  if (extra.length && !(await chrome.permissions.contains({ origins: extra }))) {
    if (!(await chrome.permissions.request({ origins: extra })))
      throw Error(
        "Redirect sites were not authorized. Remove them or allow access before recording.",
      );
  }
  return origins;
}
