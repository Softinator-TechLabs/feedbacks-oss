import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { Operations } from "./operations.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { assetRow, type AssetStore } from "./assets.js";
import { DomainError, fail } from "./errors.js";
import { inputSchemas, type OperationName } from "../shared/contracts.js";
import { Auth, accountLock, hash, secret } from "./auth.js";
import { remoteMcp } from "./mcp.js";
import { helpHtml } from "./help.js";
import { readExtensionRelease } from "./extension-release.js";
import { guestInspect, guestReply } from "./guest-links.js";
import { guestProjectInspect, guestProjectSubmit } from "./guest-project-links.js";
import { verifyGuestTurnstile } from "./turnstile.js";
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
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        req.path === "/guest" || req.path === "/guest-project"
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
    if (
      origin &&
      origin !== config.appOrigin &&
      !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    )
      return next(new DomainError("ORIGIN_DENIED", "Request origin is not allowed", 403));
    if (origin && origin !== config.appOrigin) {
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
  });
  app.use(express.json({ limit: "14mb", strict: true }));
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
  app.post("/api/:operation", async (req, res, next) => {
    try {
      const name = String(req.params.operation);
      if (!(name in inputSchemas)) fail("NOT_FOUND", "Unknown operation", 404);
      if (
        [
          "auth.login",
          "auth.consumeLoginLink",
          "auth.acceptInvite",
          "auth.resetPassword",
          "pairing.request",
          "pairing.poll",
          "guest.inspect",
          "guest.reply",
          "guestProject.inspect",
          "guestProject.submit",
        ].includes(name)
      ) {
        const ip = req.ip ?? "unknown";
        // Unverified polls get a bounded IP ingress budget, never a caller-chosen
        // device bucket. Account attempts and device creation have separate limits.
        if (name === "pairing.poll") rate(`poll-ingress:${ip}`, 600, res);
        else if (name.startsWith("guest.") || name.startsWith("guestProject."))
          rate(
            `${name}:${ip}`,
            name.endsWith(".submit") || name === "guest.reply" ? 10 : 30,
            res,
          );
        else
          rate(
            `${name === "pairing.request" ? "pairing-request" : "account"}:${ip}`,
            30,
            res,
          );
        const parsed = inputSchemas[name as OperationName].safeParse(req.body);
        if (!parsed.success) fail("VALIDATION", "Invalid request fields");
        const i: any = parsed.data;
        if (
          [
            "guest.inspect",
            "guest.reply",
            "guestProject.inspect",
            "guestProject.submit",
          ].includes(name)
        ) {
          requireOrigin(req);
          const data =
            name === "guest.inspect"
              ? await guestInspect(database, i.token, config)
              : name === "guestProject.inspect"
                ? await guestProjectInspect(database, i.token, config)
                : await (async () => {
                    await verifyGuestTurnstile(
                      config,
                      i.turnstileToken,
                      req.ip,
                      fetch,
                      name === "guestProject.submit"
                        ? "guest_project_submit"
                        : "guest_reply",
                    );
                    return database.transaction(async (db) => {
                      await accountLock(db);
                      return name === "guestProject.submit"
                        ? guestProjectSubmit(db, i)
                        : guestReply(db, i);
                    });
                  })();
          res.json({ ok: true, data });
          return;
        }
        if (name === "auth.login") {
          requireOrigin(req);
          const result = await ops.auth.login(i.email, i.password);
          res.cookie("feedbacks_session", result.token, {
            httpOnly: true,
            secure: config.production,
            sameSite: "strict",
            path: "/",
            maxAge: 7 * 86400000,
          });
          res.json({
            ok: true,
            data: {
              actor: result.actor,
              csrf: result.csrf,
              expiresAt: result.expiresAt,
            },
          });
          return;
        }
        if (name === "auth.acceptInvite") {
          requireOrigin(req);
          res.json({
            ok: true,
            data: await ops.auth.acceptInvite(i.token, i.name, i.password),
          });
          return;
        }
        if (name === "auth.resetPassword") {
          requireOrigin(req);
          res.json({
            ok: true,
            data: await ops.auth.resetPassword(i.token, i.password),
          });
          return;
        }
        if (name === "auth.consumeLoginLink") {
          requireOrigin(req);
          const result = await ops.auth.consumeLoginLink(i.token);
          res.cookie("feedbacks_session", result.token, {
            httpOnly: true,
            secure: config.production,
            sameSite: "strict",
            path: "/",
            maxAge: 7 * 86400000,
          });
          res.json({
            ok: true,
            data: {
              actor: result.actor,
              csrf: result.csrf,
              expiresAt: result.expiresAt,
            },
          });
          return;
        }
        if (name === "pairing.poll") {
          // Only proof of the real, unexpired, unconsumed device secret earns its
          // own allowance. pollPairing rechecks atomically before any token exchange.
          let verified;
          try {
            verified = await ops.auth.verifyPairing(i.pairingId, i.deviceSecret);
          } catch (error) {
            if (error instanceof DomainError && error.code === "PAIRING_EXPIRED")
              rate(`poll-invalid:${ip}`, 30, res);
            throw error;
          }
          rate(`poll-device:${verified.id}`, 30, res, verified.expiresAt);
        }
        res.json({
          ok: true,
          data:
            name === "pairing.request"
              ? await ops.auth.requestPairing(i.name)
              : await ops.auth.pollPairing(i.pairingId, i.deviceSecret),
        });
        return;
      }
      const token = bearer(req),
        actor = await ops.auth.authenticate(token, token ? undefined : cookie(req));
      if (!token) {
        requireOrigin(req);
        if (name !== "auth.me") await ops.auth.csrf(actor, req.get("X-CSRF-Token"));
      }
      const data = await ops.executeOperation(actor, name, req.body);
      if (name === "auth.me" && !token) {
        const csrf = secret();
        await database.query("UPDATE sessions SET csrf_hash=$1 WHERE hash=$2", [
          hash(csrf),
          actor.sessionHash,
        ]);
        data.csrf = csrf;
      }
      if (["auth.logout", "auth.changePassword"].includes(name))
        res.clearCookie("feedbacks_session", { path: "/" });
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/assets/:id", async (req, res, next) => {
    try {
      const actor = await ops.auth.authenticate(bearer(req), cookie(req));
      const objectKey = await database.transaction(async (db) => {
        await accountLock(db);
        const current = await new Auth(db).current(actor);
        if (current.scopes && !current.scopes.includes("assets.get"))
          fail("FORBIDDEN", "Asset scope required", 403);
        const row = await assetRow(db, current, String(req.params.id));
        return row.object_key as string;
      });
      // Revocation governs new requests; an authorized in-flight read may finish.
      // Do not hold the organization transaction lock during remote storage I/O.
      res.type("image/webp").send(await assets.get(objectKey));
    } catch (e) {
      next(e);
    }
  });
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
      res.set("Cache-Control", "no-store").sendFile(path.join(web, "index.html")),
    );
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
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
