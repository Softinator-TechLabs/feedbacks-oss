import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { Operations } from "./operations.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import type { AssetStore } from "./assets.js";
import { registerOperationRoute } from "./http/operation-route.js";
import { registerAssetDownloadRoutes } from "./http/asset-download-routes.js";
import { registerDiagnosticDownloadRoutes } from "./http/diagnostic-download-routes.js";
import { registerThreadArchiveRoutes } from "./http/thread-archive-routes.js";
import { DomainError, fail } from "./errors.js";
import { LoginThrottleError } from "./auth.js";
import { widgetLink } from "./widget.js";
import { remoteMcp } from "./mcp.js";
import { helpHtml } from "./help.js";
import { readExtensionRelease } from "./extension-release.js";
import { registerGithubAppRoutes } from "./http/github-app-routes.js";

export function createApp(config: Config, database: Database, assets: AssetStore) {
  const app = express(),
    ops = new Operations(database, assets, config),
    web = path.resolve("dist/web"),
    downloads = path.join(web, "downloads");
  app.disable("x-powered-by");
  // Trust forwarded addresses only when the operator configures the proxy path.
  app.set("trust proxy", config.trustProxyHops ?? 0);
  const attempts = new Map<string, { count: number; until: number }>();
  function rate(key: string, limit: number, res: Response, expiresAt = Infinity) {
    const now = Date.now();
    for (const [id, v] of attempts) if (v.until <= now) attempts.delete(id);
    // Bound memory even when many distinct network addresses submit requests.
    if (!attempts.has(key) && attempts.size >= 10000) {
      res.setHeader("Retry-After", "60");
      fail("RATE_LIMITED", "Too many attempts; try again shortly", 429);
    }
    const entry = attempts.get(key) ?? {
      count: 0,
      until: Math.min(now + 60000, expiresAt),
    };
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > limit) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((entry.until - now) / 1000))),
      );
      fail("RATE_LIMITED", "Too many attempts; try again shortly", 429);
    }
  }
  app.use(async (req, res, next) => {
    try {
      res.set({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy":
          req.path === "/guest" || req.path === "/guest-project" || req.path === "/survey"
            ? "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
            : "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      if (config.production)
        res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      if (
        req.path.startsWith("/api") ||
        req.path === "/mcp" ||
        ["/help", "/reset", "/owner-login", "/invite", "/sign-in"].includes(
          req.path.replace(/\/$/, ""),
        )
      )
        res.set("Cache-Control", "no-store");
      const origin = req.get("Origin");
      const widgetRequest = ["widget.inspect", "widget.submit"].includes(
        req.path.slice("/api/".length),
      );
      if (widgetRequest) {
        if (!origin || typeof req.query.linkId !== "string")
          fail("ORIGIN_DENIED", "A widget link and website origin are required", 403);
        // Count preflights and POSTs before a public link can trigger a database read.
        rate(`widget-ingress:${req.ip ?? "unknown"}`, 120, res);
        await widgetLink(database, req.query.linkId, origin);
        res.set({
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        });
        if (req.method === "OPTIONS") return res.sendStatus(204);
      } else if (
        origin &&
        origin !== config.appOrigin &&
        !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)
      )
        return next(
          new DomainError("ORIGIN_DENIED", "Request origin is not allowed", 403),
        );
      if (!widgetRequest && origin && origin !== config.appOrigin) {
        res.set({
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Headers":
            "Authorization, Content-Type, Accept, MCP-Protocol-Version",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        });
      }
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  // WebM is bounded at 40 MiB; its base64 transport needs up to 54 MiB.
  // Keep the existing smaller limit for all other HTTP operations.
  const smallJson = express.json({ limit: "14mb", strict: true });
  const recordingJson = express.json({ limit: "20mb", strict: true });
  const mediaJson = express.json({ limit: "56mb", strict: true });
  app.use((req, res, next) =>
    (req.path === "/api/assets.uploadVideo" || req.path === "/mcp"
      ? mediaJson
      : req.path === "/api/recordings.upload"
        ? recordingJson
        : smallJson)(req, res, next),
  );
  const bearer = (req: Request) =>
    req.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  const cookie = (req: Request) =>
    req
      .get("Cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("feedbacks_session="))
      ?.slice("feedbacks_session=".length);
  const requireOrigin = (req: Request) => {
    if (req.get("Origin") !== config.appOrigin)
      fail("ORIGIN_DENIED", "Use the Feedbacks web app for account authentication", 403);
  };
  app.get("/.well-known/feedbacks.json", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ product: "feedbacks", setupVersion: 1 });
  });
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  for (const name of ["extension-release.json", "feedbacks-extension.zip"]) {
    app.get(`/downloads/${name}`, (_req, res) => {
      const file = path.join(downloads, name);
      res.set("Cache-Control", "no-store");
      if (!existsSync(file)) {
        res.sendStatus(404);
        return;
      }
      res.sendFile(file);
    });
  }
  app.get("/api/help", async (req, res, next) => {
    try {
      if (bearer(req)) fail("FORBIDDEN", "Human browser session required", 403);
      const actor = await ops.auth.authenticate(undefined, cookie(req));
      if (actor.mustChangePassword)
        fail(
          "PASSWORD_CHANGE_REQUIRED",
          "Replace your temporary password before continuing",
          403,
        );
      res
        .set("Cache-Control", "no-store")
        .type("html")
        .send(helpHtml(config.appOrigin, await readExtensionRelease(downloads)));
    } catch (e) {
      next(e);
    }
  });
  app.get("/readyz", async (_req, res) => {
    try {
      await database.query("SELECT 1");
      res.json({ ok: true, database: "ready", storage: config.assetDriver });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  registerOperationRoute(app, config, database, ops, rate, bearer, cookie, requireOrigin);
  registerGithubAppRoutes(app, config, database, ops, cookie, bearer);
  registerDiagnosticDownloadRoutes(app, database, assets, ops, bearer, cookie);
  registerThreadArchiveRoutes(app, database, assets, ops, bearer, cookie);
  registerAssetDownloadRoutes(app, database, assets, ops, bearer, cookie);
  app.post("/mcp", async (req, res, next) => {
    try {
      const token = bearer(req);
      if (!token) fail("UNAUTHENTICATED", "Bearer agent token required", 401);
      const actor = await ops.auth.authenticate(token);
      if (actor.kind !== "agent") fail("FORBIDDEN", "Use an agent token for MCP", 403);
      await remoteMcp(req, res, ops, actor);
    } catch (e) {
      next(e);
    }
  });
  app.all("/mcp", (_req, res) =>
    res.status(405).json({
      ok: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use stateless Streamable HTTP POST",
      },
    }),
  );
  app.get("/help", async (req, res, next) => {
    try {
      const actor = await ops.auth.authenticate(undefined, cookie(req));
      if (actor.mustChangePassword) {
        res.redirect("/sign-in?returnTo=%2Fhelp");
        return;
      }
      next();
    } catch {
      res.redirect("/sign-in?returnTo=%2Fhelp");
    }
  });
  if (existsSync(path.join(web, "index.html"))) {
    // Vite fingerprints every compiled asset. Reuse those bytes across pages,
    // but never cache the HTML document that selects the current release.
    app.use(
      "/assets",
      express.static(path.join(web, "assets"), {
        maxAge: "1y",
        immutable: true,
        index: false,
      }),
    );
    app.use("/assets", (_req, res) => {
      res.set("Cache-Control", "no-store").sendStatus(404);
    });
    app.use(
      express.static(web, {
        index: false,
        setHeaders: (res, file) => {
          if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
        },
      }),
    );
    app.get("/{*path}", (_req, res) =>
      res.set("Cache-Control", "no-store").sendFile(path.join(web, "index.html"), {
        // Managed worktrees may live under .codex; this is a fixed, built file.
        dotfiles: "allow",
      }),
    );
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof LoginThrottleError)
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    const known = error instanceof DomainError;
    const status = known
      ? error.status
      : error.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 400
          : 500;
    res.status(status).json({
      ok: false,
      error: {
        ...(known && error.details ? { details: error.details } : {}),
        code: known
          ? error.code
          : status === 413
            ? "PAYLOAD_TOO_LARGE"
            : status === 400
              ? "INVALID_JSON"
              : "INTERNAL",
        message: known
          ? error.message
          : status === 500
            ? "Request could not be completed"
            : "Invalid or oversized request",
      },
    });
  });
  return app;
}
