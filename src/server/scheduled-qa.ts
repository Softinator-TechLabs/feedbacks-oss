import { randomUUID } from "node:crypto";
import { request } from "node:https";
import sharp from "sharp";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import type { AssetStore } from "./assets.js";
import { assetRow } from "./assets.js";
import { access, event } from "./access.js";
import { fail } from "./errors.js";
import { publicAddress, validateWebhookDestination } from "./webhooks.js";
import { Auth, accountLock } from "./auth.js";

type PageResult = {
  url: string;
  status: number | null;
  missingAlt: number;
  brokenLinks: { path: string; status: number }[];
  checkedLinks: number;
  error: string | null;
};

export function validateQaUrl(raw: string, origins: string[]) {
  if (raw.includes("?") || raw.includes("#"))
    fail("VALIDATION", "QA URL must not contain a query or fragment");
  const value = validateWebhookDestination(raw);
  const url = new URL(value);
  if (!origins.includes(url.origin))
    fail("VALIDATION", "QA page must use an exact approved project origin");
  return value;
}

async function publicPageRequest(url: string, method: "GET" | "HEAD") {
  const destination = validateWebhookDestination(url);
  const parsed = new URL(destination);
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const address = await Promise.race([
    publicAddress(parsed.hostname),
    new Promise<never>((_resolve, reject) => {
      dnsTimer = setTimeout(() => reject(Error("QA DNS timeout")), 5000);
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  return new Promise<{ status: number; body: string; contentType: string }>(
    (resolve, reject) => {
      const req = request(
        destination,
        {
          method,
          timeout: 5000,
          headers: {
            accept: "text/html",
            "accept-encoding": "identity",
            "user-agent": "Feedbacks-QA/1",
          },
          lookup: (_host, _opts, callback) =>
            callback(null, address.address, address.family),
        },
        (res) => {
          res.once("close", () => {
            clearTimeout(deadline);
            if (!res.complete) reject(Error("QA response incomplete"));
          });
          const status = res.statusCode ?? 0;
          const contentType =
            res.headers["content-encoding"] &&
            res.headers["content-encoding"] !== "identity"
              ? ""
              : String(res.headers["content-type"] ?? "");
          if (
            method === "HEAD" ||
            status !== 200 ||
            !/^text\/html(?:;|$)/i.test(contentType)
          ) {
            res.destroy();
            resolve({ status, body: "", contentType });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (part: Buffer) => {
            size += part.length;
            if (size > 256 * 1024) {
              res.destroy(Error("Page exceeds QA byte limit"));
              return;
            }
            chunks.push(part);
          });
          res.on("end", () =>
            resolve({
              status,
              body: Buffer.concat(chunks).toString("utf8"),
              contentType,
            }),
          );
          res.on("error", reject);
        },
      );
      const deadline = setTimeout(() => req.destroy(Error("QA request deadline")), 5000);
      req.on("timeout", () => req.destroy(Error("QA request timeout")));
      req.on("error", (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      req.end();
    },
  );
}

export async function scanPublicPage(
  url: string,
  fetchPage = publicPageRequest,
): Promise<PageResult> {
  const result: PageResult = {
    url,
    status: null,
    missingAlt: 0,
    brokenLinks: [],
    checkedLinks: 0,
    error: null,
  };
  try {
    const page = await fetchPage(url, "GET");
    result.status = page.status;
    if (page.status !== 200) {
      result.error = "Page did not return HTTP 200";
      return result;
    }
    if (!/^text\/html(?:;|$)/i.test(page.contentType)) {
      result.error = "Page is not HTML";
      return result;
    }
    result.missingAlt = Math.min(
      10,
      [...page.body.matchAll(/<img\b[^>]*>/gi)].filter(
        (match) => !/\balt\s*=/i.test(match[0]),
      ).length,
    );
    const links = new Set<string>();
    for (const match of page.body.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)) {
      if (links.size >= 6) break;
      try {
        const target = new URL(match[2], url);
        if (
          target.origin === new URL(url).origin &&
          !target.search &&
          !target.hash &&
          target.href.length <= 500 &&
          target.href !== url
        )
          links.add(target.href);
      } catch {
        /* Ignore malformed HTML destinations. */
      }
    }
    for (const target of links) {
      try {
        const head = await fetchPage(target, "HEAD");
        result.checkedLinks++;
        if (head.status === 404 || head.status === 410)
          result.brokenLinks.push({
            path: new URL(target).pathname,
            status: head.status,
          });
      } catch {
        /* Network and unsupported HEAD outcomes are unknown. */
      }
    }
  } catch {
    result.error = "Page request failed or exceeded the QA limit";
  }
  return result;
}

export async function manageQa(db: Database, actor: Actor, op: string, input: any) {
  if (op === "qa.baselineGet" || op === "qa.baselineSet") {
    const thread = await db.one("SELECT project_id FROM threads WHERE id=$1", [
      input.threadId,
    ]);
    if (!thread) fail("NOT_FOUND", "Thread not found", 404);
    await access(
      db,
      actor,
      thread.project_id,
      op === "qa.baselineSet" ? "maintain" : "read",
    );
    if (op === "qa.baselineGet") {
      const row = await db.one(
        "SELECT asset_id,set_at FROM qa_baselines WHERE thread_id=$1",
        [input.threadId],
      );
      return {
        assetId: row?.asset_id ?? null,
        setAt: row?.set_at?.toISOString() ?? null,
      };
    }
    const asset = await assetRow(db, actor, input.assetId);
    if (asset.thread_id !== input.threadId || asset.data.contentType !== "image/webp")
      fail("VALIDATION", "Baseline must be an image from this thread");
    const row = await db.one(
      "INSERT INTO qa_baselines(thread_id,asset_id) VALUES($1,$2) ON CONFLICT(thread_id) DO UPDATE SET asset_id=excluded.asset_id,set_at=now() RETURNING set_at",
      [input.threadId, input.assetId],
    );
    await event(db, actor, thread.project_id, input.threadId, "qa.baseline.changed", {
      assetId: input.assetId,
    });
    return { assetId: input.assetId, setAt: row.set_at.toISOString() };
  }
  const project = await access(db, actor, input.projectId, "maintain");
  if (op === "qa.get" || op === "qa.configure") {
    if (op === "qa.configure") {
      if (input.enabled && !input.urls.length)
        fail("VALIDATION", "Select at least one QA page");
      const urls = [
        ...new Set(input.urls.map((url: string) => validateQaUrl(url, project.origins))),
      ];
      await db.query(
        `INSERT INTO qa_configs(project_id,enabled,urls,next_at) VALUES($1,$2,$3,now())
         ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,urls=excluded.urls,
         next_at=CASE WHEN qa_configs.enabled THEN qa_configs.next_at ELSE GREATEST(now(),COALESCE((SELECT max(created_at)+interval '1 hour' FROM qa_runs WHERE project_id=$1),now())) END,
         updated_at=now()`,
        [input.projectId, input.enabled, JSON.stringify(urls)],
      );
      await event(db, actor, input.projectId, input.projectId, "qa.configured", {
        enabled: input.enabled,
        pages: urls.length,
      });
    }
    const row = await db.one(
      "SELECT enabled,urls,next_at FROM qa_configs WHERE project_id=$1",
      [input.projectId],
    );
    return {
      enabled: row?.enabled ?? false,
      urls: row?.urls ?? [],
      nextAt: row?.enabled ? row.next_at.toISOString() : null,
    };
  }
  if (op === "qa.runNow") {
    const recent = await db.one(
      "SELECT id FROM qa_runs WHERE project_id=$1 AND created_at>now()-interval '1 hour' LIMIT 1",
      [input.projectId],
    );
    if (recent) fail("RATE_LIMIT", "Wait one hour between manual QA scans", 429);
    const row = await db.one(
      "UPDATE qa_configs SET next_at=now() WHERE project_id=$1 AND enabled=true RETURNING project_id",
      [input.projectId],
    );
    if (!row) fail("NOT_FOUND", "Enable project QA first", 404);
    return { queued: true };
  }
  const rows = await db.query(
    "SELECT id,pages,created_at FROM qa_runs WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20",
    [input.projectId],
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      pages: row.pages,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

export async function compareQaImages(
  db: Database,
  actor: Actor,
  store: AssetStore,
  input: { threadId: string; assetId: string },
) {
  const rows = await db.transaction(async (tx) => {
    await accountLock(tx);
    const current = await new Auth(tx).current(actor);
    if (current.scopes && !current.scopes.includes("qa.compare"))
      fail("FORBIDDEN", "Operation outside token scope", 403);
    const thread = await tx.one("SELECT project_id FROM threads WHERE id=$1", [
      input.threadId,
    ]);
    if (!thread) fail("NOT_FOUND", "Thread not found", 404);
    await access(tx, current, thread.project_id);
    const baseline = await tx.one(
      "SELECT asset_id FROM qa_baselines WHERE thread_id=$1",
      [input.threadId],
    );
    if (!baseline) fail("NOT_FOUND", "Set a screenshot baseline first", 404);
    const before = await assetRow(tx, current, baseline.asset_id);
    const after = await assetRow(tx, current, input.assetId);
    if (
      before.thread_id !== input.threadId ||
      after.thread_id !== input.threadId ||
      before.data.contentType !== "image/webp" ||
      after.data.contentType !== "image/webp"
    )
      fail("VALIDATION", "Compare two images from the same thread");
    if (
      before.data.width !== after.data.width ||
      before.data.height !== after.data.height
    )
      fail("VALIDATION", "Images must have matching dimensions");
    if (before.data.width * before.data.height > 4_000_000)
      fail("VALIDATION", "Images exceed comparison pixel limit");
    return { before, after };
  });
  const [a, b] = await Promise.all([
    store.get(rows.before.object_key),
    store.get(rows.after.object_key),
  ]);
  const [left, right] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer(),
    sharp(b).ensureAlpha().raw().toBuffer(),
  ]);
  if (left.length !== right.length) fail("VALIDATION", "Images have incompatible pixels");
  let changed = 0;
  for (let n = 0; n < left.length; n += 4)
    if (
      Math.abs(left[n] - right[n]) > 20 ||
      Math.abs(left[n + 1] - right[n + 1]) > 20 ||
      Math.abs(left[n + 2] - right[n + 2]) > 20 ||
      Math.abs(left[n + 3] - right[n + 3]) > 20
    )
      changed++;
  return {
    baselineAssetId: rows.before.id,
    candidateAssetId: rows.after.id,
    width: rows.before.data.width,
    height: rows.before.data.height,
    changedPercent: Math.round((changed / (left.length / 4)) * 10000) / 100,
  };
}

export async function runScheduledQa(db: Database, scanner = scanPublicPage) {
  const job = await db.transaction(async (tx) => {
    const row = await tx.one(
      "SELECT project_id,urls FROM qa_configs WHERE enabled=true AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_at,project_id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (!row) return null;
    await tx.query(
      "UPDATE qa_configs SET next_at=now()+interval '24 hours',lease_until=now()+interval '10 minutes' WHERE project_id=$1",
      [row.project_id],
    );
    return row;
  });
  if (!job) return;
  const project = await db.one("SELECT data FROM projects WHERE id=$1", [job.project_id]);
  const pages: PageResult[] = [];
  for (const url of job.urls.slice(0, 3)) {
    try {
      validateQaUrl(url, project?.data.origins ?? []);
    } catch {
      pages.push({
        url,
        status: null,
        missingAlt: 0,
        brokenLinks: [],
        checkedLinks: 0,
        error: "Page is no longer approved for QA",
      });
      continue;
    }
    try {
      pages.push(await scanner(url));
    } catch {
      pages.push({
        url,
        status: null,
        missingAlt: 0,
        brokenLinks: [],
        checkedLinks: 0,
        error: "Page scan failed",
      });
    }
  }
  await db.transaction(async (tx) => {
    const active = await tx.one(
      "SELECT enabled FROM qa_configs WHERE project_id=$1 FOR UPDATE",
      [job.project_id],
    );
    if (active?.enabled) {
      await tx.query("INSERT INTO qa_runs(id,project_id,pages) VALUES($1,$2,$3)", [
        randomUUID(),
        job.project_id,
        JSON.stringify(pages),
      ]);
      await tx.query(
        "DELETE FROM qa_runs WHERE project_id=$1 AND id NOT IN (SELECT id FROM qa_runs WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20)",
        [job.project_id],
      );
    }
    await tx.query("UPDATE qa_configs SET lease_until=NULL WHERE project_id=$1", [
      job.project_id,
    ]);
  });
}
