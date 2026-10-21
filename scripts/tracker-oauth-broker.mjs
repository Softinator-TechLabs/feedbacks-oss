import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// Optional shared confidential OAuth application. Installation servers connect outbound.
// Client secrets stay here; access/refresh tokens are delivered only to the requesting installation.
const digest = (value) => createHash("sha256").update(value).digest();
const secret = () => randomBytes(32).toString("base64url");
const equal = (a, b) =>
  typeof a === "string" && typeof b === "string" && timingSafeEqual(digest(a), digest(b));
const flows = new Map(),
  refreshes = new Map(),
  budgets = new Map();
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const publicOrigin = new URL(required("TRACKER_BROKER_PUBLIC_ORIGIN"));
if (
  publicOrigin.protocol !== "https:" ||
  publicOrigin.pathname !== "/" ||
  publicOrigin.username ||
  publicOrigin.password ||
  publicOrigin.hash ||
  publicOrigin.search
)
  throw new Error("TRACKER_BROKER_PUBLIC_ORIGIN must be an HTTPS origin");
const installationKeys = JSON.parse(required("TRACKER_BROKER_INSTALLATION_KEYS"));
if (
  !Array.isArray(installationKeys) ||
  !installationKeys.length ||
  installationKeys.length > 1000 ||
  installationKeys.some(
    (key) => typeof key !== "string" || key.length < 32 || key.length > 1000,
  )
)
  throw new Error(
    "TRACKER_BROKER_INSTALLATION_KEYS must be a JSON array of strong per-installation keys",
  );
const clientId = required("TRACKER_BROKER_JIRA_CLIENT_ID"),
  clientSecret = required("TRACKER_BROKER_JIRA_CLIENT_SECRET");
const callback = new URL("/oauth/jira/callback", publicOrigin).toString();
const send = (res, status, data) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
  });
  res.end(JSON.stringify(data));
};
const cleanup = () => {
  const now = Date.now();
  for (const [id, flow] of flows) if (flow.expires < now) flows.delete(id);
  for (const [id, refresh] of refreshes) if (refresh.expires < now) refreshes.delete(id);
  for (const [id, budget] of budgets) if (budget.until < now) budgets.delete(id);
};
setInterval(cleanup, 60000).unref();
async function json(req) {
  let text = "";
  for await (const bytes of req) {
    text += bytes;
    if (text.length > 40000) throw new Error("Body too large");
  }
  return JSON.parse(text || "{}");
}
async function providerJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Provider rejected request");
  }
  const text = await response.text();
  if (text.length > 128000) throw new Error("Invalid provider response");
  return JSON.parse(text);
}
async function token(input) {
  const value = await providerJson("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, client_id: clientId, client_secret: clientSecret }),
  });
  if (typeof value.access_token !== "string" || typeof value.expires_in !== "number")
    throw new Error("Invalid provider response");
  return value;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/healthz" && req.method === "GET")
      return send(res, 200, { ready: true });
    if (url.pathname === "/oauth/jira/callback" && req.method === "GET") {
      const flow = [...flows.values()].find((item) =>
        equal(item.state, url.searchParams.get("state")),
      );
      if (!flow || flow.expires < Date.now() || flow.callbackUsed)
        return send(res, 410, {
          error:
            "Consent expired or was already used. Return to Feedbacks and reconnect.",
        });
      flow.callbackUsed = true;
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.has("error")) {
        flow.error = true;
        return send(res, 400, {
          error: "Consent was declined. Return to Feedbacks to reconnect.",
        });
      }
      try {
        const value = await token({
          grant_type: "authorization_code",
          code,
          redirect_uri: callback,
        });
        const resources = await providerJson(
          "https://api.atlassian.com/oauth/token/accessible-resources",
          { headers: { authorization: `Bearer ${value.access_token}` } },
        );
        flow.result = { token: value, resources };
        return send(res, 200, {
          message: "Connected. Return to Feedbacks and finish choosing your Jira site.",
        });
      } catch {
        flow.error = true;
        return send(res, 502, {
          error:
            "The provider could not complete consent. Return to Feedbacks to reconnect.",
        });
      }
    }
    if (
      req.method !== "POST" ||
      !["/v1/start", "/v1/poll", "/v1/ack", "/v1/refresh"].includes(url.pathname)
    )
      return send(res, 404, { error: "Not found" });
    const key = req.headers.authorization?.replace(/^Bearer /, "");
    const matched = installationKeys.find((candidate) => equal(candidate, key));
    if (!matched)
      return send(res, 401, { error: "Installation authentication required" });
    const installation = digest(matched).toString("hex");
    let budget = budgets.get(installation);
    if (!budget || budget.until < Date.now()) {
      budget = { n: 0, until: Date.now() + 60000 };
      budgets.set(installation, budget);
    }
    if (++budget.n > 90) return send(res, 429, { error: "Try again in one minute" });
    const input = await json(req);
    cleanup();
    if (url.pathname === "/v1/start") {
      if (input.provider !== "jira")
        return send(res, 400, { error: "Unsupported OAuth provider" });
      if (
        flows.size >= 1000 ||
        [...flows.values()].filter((flow) => flow.installation === installation).length >=
          10
      )
        return send(res, 429, { error: "Too many pending consent flows" });
      const id = secret(),
        pollToken = secret(),
        state = secret();
      flows.set(id, {
        installation,
        pollToken: digest(pollToken).toString("hex"),
        state,
        expires: Date.now() + 600000,
        callbackUsed: false,
      });
      const authorize = new URL("https://auth.atlassian.com/authorize");
      for (const [name, value] of Object.entries({
        audience: "api.atlassian.com",
        client_id: clientId,
        scope: "read:jira-work write:jira-work read:jira-user offline_access",
        redirect_uri: callback,
        state,
        response_type: "code",
        prompt: "consent",
      }))
        authorize.searchParams.set(name, value);
      return send(res, 200, {
        flowId: id,
        pollToken,
        authorizeUrl: authorize.toString(),
      });
    }
    if (url.pathname === "/v1/refresh") {
      if (
        input.provider !== "jira" ||
        typeof input.refreshToken !== "string" ||
        input.refreshToken.length > 16000
      )
        return send(res, 400, { error: "Invalid refresh request" });
      const cacheKey = installation + ":" + digest(input.refreshToken).toString("hex");
      let item = refreshes.get(cacheKey);
      if (!item) {
        if (refreshes.size >= 1000)
          return send(res, 429, { error: "Refresh capacity reached" });
        // Preserve one in-flight exchange and its rotated token for retry after lost responses.
        item = {
          expires: Date.now() + 600000,
          promise: token({
            grant_type: "refresh_token",
            refresh_token: input.refreshToken,
          }),
        };
        refreshes.set(cacheKey, item);
      }
      return send(res, 200, await item.promise);
    }
    const flow = typeof input.flowId === "string" ? flows.get(input.flowId) : null;
    if (
      !flow ||
      flow.installation !== installation ||
      !equal(
        flow.pollToken,
        typeof input.pollToken === "string"
          ? digest(input.pollToken).toString("hex")
          : "",
      )
    )
      return send(res, 410, { error: "Consent flow expired" });
    if (url.pathname === "/v1/ack") {
      flows.delete(input.flowId);
      return send(res, 200, { removed: true });
    }
    if (flow.error)
      return send(res, 409, { error: "Consent failed. Start a new connection." });
    return send(
      res,
      200,
      flow.result ? { status: "ready", ...flow.result } : { status: "pending" },
    );
  } catch {
    return send(res, 502, {
      error: "The connection could not be completed. Retry or restart consent.",
    });
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
const port = Number(process.env.PORT || 4786);
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(
    `OAuth broker listening on loopback port ${server.address().port}; reverse proxy the configured HTTPS origin.\n`,
  ),
);
