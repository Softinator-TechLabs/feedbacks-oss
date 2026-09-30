import type { Express, Request } from "express";
import type { Config } from "../config.js";
import type { Operations } from "../operations.js";
import type { Database } from "../db.js";
import { githubRegistrationRequest } from "../github-managed-apps.js";
import { fail } from "../errors.js";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
export function registerGithubAppRoutes(
  app: Express,
  config: Config,
  db: Database,
  ops: Operations,
  cookie: (req: Request) => string | undefined,
  bearer: (req: Request) => string | undefined,
) {
  app.get("/api/github-app/register", async (req, res, next) => {
    try {
      if (bearer(req)) fail("FORBIDDEN", "Use a human browser session.", 403);
      if (
        typeof req.query.state !== "string" ||
        !/^[A-Za-z0-9_-]{32,100}$/.test(req.query.state)
      )
        fail("GITHUB_SETUP_EXPIRED", "Start again from GitHub Apps.", 409);
      const actor = await ops.auth.authenticate(undefined, cookie(req));
      const form = await githubRegistrationRequest(db, actor, req.query.state, config);
      res
        .set({
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; form-action https://github.com; frame-ancestors 'none'; base-uri 'none'",
        })
        .type("html")
        .send(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect GitHub App</title><script defer src="/learn/github-app-register.js"></script></head><body><h1>Continue to GitHub</h1><p>Approve your private App, then select its repositories.</p><form id="github-app-registration" method="post" action="' +
            escape(form.actionUrl) +
            '"><input type="hidden" name="manifest" value="' +
            escape(form.manifest) +
            '"><button type="submit">Continue to GitHub</button></form></body></html>',
        );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/github-app/setup-callback", (req, res) => {
    res.set("Cache-Control", "no-store");
    const state = req.query.state,
      code = req.query.code;
    if (
      bearer(req) ||
      typeof state !== "string" ||
      typeof code !== "string" ||
      !/^[A-Za-z0-9_-]{32,100}$/.test(state) ||
      !/^[A-Za-z0-9_-]{20,200}$/.test(code)
    ) {
      res.redirect(303, "/github-apps?setup=failed");
      return;
    }
    // GitHub's cross-site navigation cannot send our SameSite=Strict session.
    // This self-hosted bridge establishes a same-origin document before the
    // ordinary cookie + CSRF operation rechecks current owner and setup state.
    res
      .type("html")
      .send(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting GitHub App</title><script defer src="/learn/github-app-callback.js"></script></head><body><main id="github-app-callback" data-state="' +
          escape(state) +
          '" data-code="' +
          escape(code) +
          '"><h1>Connecting your GitHub App</h1><p>Completing setup in Feedbacks…</p><noscript>Enable JavaScript and start again from GitHub Apps, or connect the existing App with its private key.</noscript></main></body></html>',
      );
  });
}
