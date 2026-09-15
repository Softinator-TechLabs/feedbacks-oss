const RELEASE_PATH = "/downloads/extension-release.json";
const DOWNLOAD_PATH = "/downloads/feedbacks-extension.zip";
const CACHE_KEY = "extensionReleaseChecks";
const CACHE_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_RELEASE_BYTES = 100 * 1024 * 1024;

function versionParts(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const numbers = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,4})$/.test(part)) return null;
    const number = Number(part);
    if (number > 65535) return null;
    numbers.push(number);
  }
  return numbers;
}

export function compareChromeVersions(left, right) {
  const a = versionParts(left),
    b = versionParts(right);
  if (!a || !b) throw new TypeError("Invalid Chrome extension version.");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function validateReleaseRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.join(",") !== "bytes,downloadPath,sha256,version" ||
    !versionParts(value.version) ||
    value.downloadPath !== DOWNLOAD_PATH ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > MAX_RELEASE_BYTES
  )
    return null;
  return {
    version: value.version,
    downloadPath: DOWNLOAD_PATH,
    sha256: value.sha256,
    bytes: value.bytes,
  };
}

function serverOrigin(value) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new TypeError("Invalid Feedbacks server origin.");
  return url.origin;
}

export function releaseLinks(server, release) {
  const origin = serverOrigin(server);
  return {
    download: `${origin}${DOWNLOAD_PATH}?v=${encodeURIComponent(release.version)}`,
    help: `${origin}/help#update-extension`,
  };
}

export function createReleaseSelectionGate() {
  let revision = 0,
    selectedServer = "";
  return {
    select(server) {
      selectedServer = server;
      return { server, revision: ++revision };
    },
    isCurrent(ticket) {
      return ticket.server === selectedServer && ticket.revision === revision;
    },
  };
}

export async function fetchReleaseRecord(
  server,
  { fetchImpl = fetch, timeoutMs = 5000 } = {},
) {
  const origin = serverOrigin(server),
    controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error("Release check timed out.");
    error.name = "TimeoutError";
    controller.abort(error);
  }, timeoutMs);
  try {
    const response = await fetchImpl(origin + RELEASE_PATH, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Release check returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 4096) throw new Error("Release metadata is too large.");
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Release metadata is not valid JSON.");
    }
    const release = validateReleaseRecord(value);
    if (!release) throw new Error("Release metadata is invalid.");
    return release;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdates({
  server,
  installedVersion,
  bypassCache = false,
  now = Date.now(),
  storage = chrome.storage.local,
  permissions = chrome.permissions,
  fetchImpl = fetch,
  timeoutMs = 5000,
}) {
  const origin = serverOrigin(server);
  let cache = {},
    cached = null;
  try {
    cache = (await storage.get(CACHE_KEY))[CACHE_KEY] || {};
    const entry = cache[origin];
    const release = validateReleaseRecord(entry?.release);
    if (release && Number.isSafeInteger(entry.checkedAt))
      cached = { checkedAt: entry.checkedAt, release };
  } catch {
    cache = {};
  }

  try {
    if (!(await permissions.contains({ origins: [origin + "/*"] })))
      return { release: null, newer: false, status: "not-permitted" };
  } catch (error) {
    return resultFrom(cached?.release || null, installedVersion, "error", error);
  }

  if (
    !bypassCache &&
    cached &&
    now >= cached.checkedAt &&
    now - cached.checkedAt < CACHE_AGE_MS
  )
    return resultFrom(cached.release, installedVersion, "cached");

  try {
    const release = await fetchReleaseRecord(origin, { fetchImpl, timeoutMs });
    const entries = Object.entries({
      ...cache,
      [origin]: { checkedAt: now, release },
    }).sort(([, a], [, b]) => (b?.checkedAt || 0) - (a?.checkedAt || 0));
    try {
      await storage.set({ [CACHE_KEY]: Object.fromEntries(entries.slice(0, 20)) });
    } catch {
      // A usable network result should remain visible even if local cache writes fail.
    }
    return resultFrom(release, installedVersion, "network");
  } catch (error) {
    return resultFrom(cached?.release || null, installedVersion, "error", error);
  }
}

function resultFrom(release, installedVersion, status, error) {
  return {
    release,
    newer: !!release && compareChromeVersions(release.version, installedVersion) > 0,
    status,
    ...(error ? { error } : {}),
  };
}
