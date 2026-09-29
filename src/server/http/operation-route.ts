import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Config } from "../config.js";
import type { Database } from "../db.js";
import type { Operations } from "../operations.js";
import { DomainError, fail } from "../errors.js";
import { inputSchemas, type OperationName } from "../../shared/contracts.js";
import { accountLock, hash, secret } from "../auth.js";
import { guestInspect, guestReply } from "../guest-links.js";
import { guestProjectInspect, guestProjectSubmit } from "../guest-project-links.js";
import { verifyGuestTurnstile } from "../turnstile.js";
import { widgetInspect, widgetLink } from "../widget.js";
import { surveyInspect, surveySubmit } from "../surveys.js";

type RequestAuth = (req: Request) => string | undefined;
type Rate = (key: string, limit: number, res: Response, expiresAt?: number) => void;

function canonicalClientIp(value?: string) {
  if (!value || !isIP(value))
    fail(
      "CLIENT_ADDRESS_UNAVAILABLE",
      "Sign-in could not verify your network address",
      400,
    );
  if (isIP(value) === 4) return value;
  const [address, zone] = value.split("%", 2);
  const ipv6 = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (zone) return `${ipv6}%${zone}`;
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(ipv6);
  if (!mapped) return ipv6;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
export function registerOperationRoute(
  app: Express,
  config: Config,
  database: Database,
  ops: Operations,
  rate: Rate,
  bearer: RequestAuth,
  cookie: RequestAuth,
  requireOrigin: (req: Request) => void,
) {
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
          "widget.inspect",
          "widget.submit",
          "survey.inspect",
          "survey.submit",
        ].includes(name)
      ) {
        const ip = req.ip ?? "unknown";
        // Unverified polls get a bounded IP ingress budget, never a caller-chosen
        // device bucket. Account attempts and device creation have separate limits.
        if (name === "pairing.poll") rate(`poll-ingress:${ip}`, 600, res);
        else if (
          name.startsWith("guest.") ||
          name.startsWith("guestProject.") ||
          name.startsWith("widget.") ||
          name.startsWith("survey.")
        )
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
        if (name.startsWith("survey.")) {
          requireOrigin(req);
          if (name === "survey.inspect") {
            res.json({ ok: true, data: await surveyInspect(database, i.token, config) });
            return;
          }
          await verifyGuestTurnstile(
            config,
            i.turnstileToken,
            req.ip,
            fetch,
            "survey_submit",
          );
          const data = await database.transaction(async (db) => {
            await accountLock(db);
            return surveySubmit(db, i);
          });
          res.json({ ok: true, data });
          return;
        }
        if (name.startsWith("widget.")) {
          if (req.query.linkId !== i.linkId)
            fail("ORIGIN_DENIED", "Widget link does not match request", 403);
          if (name === "widget.inspect") {
            res.json({
              ok: true,
              data: await widgetInspect(database, i, req.get("Origin")!, config),
            });
            return;
          }
          const origin = req.get("Origin")!;
          await widgetLink(database, i.linkId, origin, i.token);
          const threadId = randomUUID();
          await verifyGuestTurnstile(
            config,
            i.turnstileToken,
            req.ip,
            fetch,
            "widget_submit",
            new URL(origin).hostname,
          );
          const data = await database.transaction(async (db) => {
            await accountLock(db);
            return guestProjectSubmit(db, {
              ...i,
              widget: { linkId: i.linkId, origin, viewport: i.viewport, threadId },
            });
          });
          res.json({ ok: true, data });
          return;
        }
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
          const result = await ops.auth.login(
            i.email,
            i.password,
            canonicalClientIp(req.ip),
          );
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
}
