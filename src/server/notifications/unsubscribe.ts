import express, { type Express } from "express";
import type { Database } from "../db.js";
import { accountLock } from "../auth.js";
export function registerUnsubscribe(app: Express, db: Database) {
  app.get("/notifications/unsubscribe", (req, res) => {
    const token = req.query.token;
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      res.status(400).type("text").send("This notification link is invalid.");
      return;
    }
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences · Feedbacks</title><body><main><h1>Stop project email notifications?</h1><p>This stops emails for this subscription. It does not change project access.</p><form method="post" action="/notifications/unsubscribe"><input type="hidden" name="token" value="${token}"><button type="submit">Unsubscribe from this project</button></form></main></body></html>`,
      );
  });
  app.post(
    "/notifications/unsubscribe",
    express.urlencoded({ extended: false, limit: "1kb" }),
    async (req, res, next) => {
      try {
        const token = req.body?.token;
        if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
          res.status(400).send("Invalid notification link.");
          return;
        }
        await db.transaction(async (tx) => {
          await accountLock(tx);
          await tx.query(
            "UPDATE notification_subscriptions SET events='[]'::jsonb,revision=revision+1 WHERE unsubscribe_token=$1",
            [token],
          );
        });
        res
          .set("Cache-Control", "no-store")
          .type("html")
          .send(
            '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed · Feedbacks</title><body><main><h1>Project emails stopped</h1><p>You can subscribe again from the project’s email preferences.</p><a href="/">Open Feedbacks</a></main></body></html>',
          );
      } catch (error) {
        next(error);
      }
    },
  );
}
