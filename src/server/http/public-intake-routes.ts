import express, { type Express } from "express";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import { fail } from "../errors.js";
import {
  intakeInstallation,
  intakeBudget,
  inspectIntake,
  publicIntakeInputs,
  submitIntake,
} from "../public-intake.js";
import { verifyGuestTurnstile } from "../turnstile.js";

/** Register immediately after trust-proxy setup, before the general origin gate. */
export function registerPublicIntakeRoutes(
  app: Express,
  database: Database,
  config: Config,
) {
  const router = express.Router();
  const attempts = new Map<string, { count: number; until: number }>();
  router.use(async (req, res, next) => {
    try {
      res.set({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      if (!["POST", "OPTIONS"].includes(req.method))
        fail("METHOD_NOT_ALLOWED", "Use POST for public intake", 405);
      const origin = req.get("Origin"),
        intakeId = req.query.intakeId;
      if (!origin || origin === "null" || typeof intakeId !== "string")
        fail("ORIGIN_DENIED", "An approved website origin is required", 403);
      const now = Date.now(),
        address = req.ip ?? "unknown";
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const counter = attempts.get(address) ?? { count: 0, until: now + 60000 };
      if ((!attempts.has(address) && attempts.size >= 10000) || ++counter.count > 120)
        fail("RATE_LIMITED", "Too many requests. Try again later.", 429);
      attempts.set(address, counter);
      const row = await intakeInstallation(database, intakeId, origin);
      await intakeBudget(database, config, row, address, "ingress");
      res.set({
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      res.locals.intake = row;
      next();
    } catch (error) {
      next(error);
    }
  });
  router.use(express.json({ limit: "64kb", strict: true }));
  router.post("/api/intake.inspect", async (req, res, next) => {
    try {
      const parsed = publicIntakeInputs.inspect.safeParse(req.body);
      if (!parsed.success) fail("VALIDATION", "Invalid feedback installation fields");
      const input = parsed.data;
      if (input.intakeId !== req.query.intakeId)
        fail("VALIDATION", "Installation IDs must match");
      res.json({ ok: true, data: inspectIntake(res.locals.intake, config) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/intake.submit", async (req, res, next) => {
    try {
      const parsed = publicIntakeInputs.submit.safeParse(req.body);
      if (!parsed.success) fail("VALIDATION", "Invalid public feedback fields");
      const input = parsed.data,
        origin = req.get("Origin")!;
      if (input.intakeId !== req.query.intakeId)
        fail("VALIDATION", "Installation IDs must match");
      await intakeBudget(
        database,
        config,
        res.locals.intake,
        req.ip ?? "unknown",
        "submit",
      );
      if (input.website)
        fail("VERIFICATION_FAILED", "The feedback form could not be verified", 403);
      await verifyGuestTurnstile(
        config,
        input.turnstileToken,
        req.ip,
        undefined,
        "intake_submit",
        new URL(origin).hostname,
      );
      const data = await database.transaction((db) => submitIntake(db, input, origin));
      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });
  app.use((req, res, next) =>
    ["/api/intake.inspect", "/api/intake.submit"].includes(req.path)
      ? router(req, res, next)
      : next(),
  );
}
