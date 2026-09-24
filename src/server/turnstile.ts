import type { Config } from "./config.js";
import { requireTurnstile } from "./guest-links.js";
import { fail } from "./errors.js";

type Siteverify = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

export async function verifyGuestTurnstile(
  config: Config,
  token: string,
  remoteIp?: string,
  fetcher: typeof fetch = fetch,
  action = "guest_reply",
) {
  const { secretKey } = requireTurnstile(config);
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  let result: Siteverify;
  try {
    const response = await fetcher(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw Error("Siteverify unavailable");
    result = (await response.json()) as Siteverify;
  } catch {
    fail("VERIFICATION_UNAVAILABLE", "Verification is unavailable. Try again.", 503);
  }
  if (result.success !== true)
    fail("VERIFICATION_FAILED", "Verification expired or failed. Try again.", 403);
  if (config.production) {
    const hostname = new URL(config.appOrigin).hostname;
    if (result.hostname !== hostname || result.action !== action)
      fail("VERIFICATION_FAILED", "Verification did not match this form", 403);
  }
}
