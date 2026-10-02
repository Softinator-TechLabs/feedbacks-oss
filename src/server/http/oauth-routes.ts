import express, { type Express, type Request, type Response } from "express";
import type { Config } from "../config.js";
import type { Database } from "../db.js";
import type { Operations } from "../operations.js";
import { McpOAuth, OAuthError } from "../oauth.js";
import { DomainError, fail } from "../errors.js";

export function registerOAuthRoutes(
  app: Express,
  config: Config,
  database: Database,
  ops: Operations,
  cookie: (req: Request) => string | undefined,
  rate: (key: string, limit: number, res: Response) => void,
) {
  const oauth = new McpOAuth(database, config);
  const route =
    (limit: number, work: (req: Request, res: Response) => Promise<void> | void) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        oauth.enabled();
        rate(`oauth:${req.path}:${req.ip ?? "unknown"}`, limit, res);
        await work(req, res);
      } catch (error) {
        if (error instanceof OAuthError)
          res
            .status(error.status)
            .json({ error: error.code, error_description: error.message });
        else if (error instanceof DomainError)
          res.status(error.status).json(
            req.path === "/oauth/consent"
              ? { ok: false, error: { code: error.code, message: error.message } }
              : {
                  error:
                    error.status === 429 ? "temporarily_unavailable" : "access_denied",
                  error_description: error.message,
                },
          );
        else
          res
            .status(500)
            .json({ error: "server_error", error_description: "OAuth request failed" });
      }
    };
  const human = async (req: Request) => {
    if (req.get("Authorization")) fail("FORBIDDEN", "Use a human browser session", 403);
    return ops.auth.authenticate(undefined, cookie(req));
  };
  app.get(
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ],
    route(120, (_req, res) => {
      res.json(oauth.protectedMetadata());
    }),
  );
  app.get(
    "/.well-known/oauth-authorization-server",
    route(120, (_req, res) => {
      res.json(oauth.metadata());
    }),
  );
  app.post(
    "/oauth/register",
    route(10, async (req, res) => {
      res.status(201).json(await oauth.register(req.body));
    }),
  );
  app.get(
    "/oauth/authorize",
    route(30, async (req, res) => {
      res.redirect(303, await oauth.authorize(req.query));
    }),
  );
  app.get(
    "/oauth/consent",
    route(60, async (req, res) => {
      if (
        typeof req.query.request !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(req.query.request)
      )
        throw new OAuthError("invalid_request", "Connection request is required");
      res.json({
        ok: true,
        data: await oauth.inspect(await human(req), req.query.request),
      });
    }),
  );
  app.post(
    "/oauth/consent",
    route(30, async (req, res) => {
      if (req.get("Origin") !== config.appOrigin)
        fail("ORIGIN_DENIED", "Use the Feedbacks web app", 403);
      const actor = await human(req);
      await ops.auth.csrf(actor, req.get("X-CSRF-Token"));
      res.json({ ok: true, data: await oauth.consent(actor, req.body) });
    }),
  );
  const form = express.urlencoded({ extended: false, limit: "8kb", parameterLimit: 20 });
  app.post(
    "/oauth/token",
    form,
    route(60, async (req, res) => {
      res.json(await oauth.token(req.body));
    }),
  );
  app.post(
    "/oauth/revoke",
    form,
    route(60, async (req, res) => {
      await oauth.revoke(req.body);
      res.sendStatus(200);
    }),
  );
  return oauth;
}
