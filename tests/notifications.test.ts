import { notificationOperation } from "../src/server/notifications/operations.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import { deliverNotifications } from "../src/server/notifications/worker.js";
import { MailSendError, sendMail } from "../src/server/notifications/transport.js";
import { seedMailEnvironment } from "../src/server/notifications/environment.js";
import { loadMailTransport } from "../src/server/notifications/settings.js";
import { defaultTemplates, renderMailTemplate } from "../src/shared/notifications.js";
import { inputSchemas, outputSchemas, agentOperations } from "../src/shared/contracts.js";

async function fixture() {
  const pg = new PGlite();
  const db = new Database(pg as any);
  await migrate(db);
  const config = configFromEnv({
    DATABASE_URL: "postgres://synthetic",
    APP_ORIGIN: "http://localhost:3000",
  });
  const objects = new Map<string, Buffer>();
  const store = {
    put: async (k: string, v: Buffer) => {
      objects.set(k, v);
    },
    get: async (k: string) => {
      if (!objects.has(k)) throw Error("Unavailable synthetic key");
      return objects.get(k)!;
    },
    remove: async (k: string) => {
      objects.delete(k);
    },
  };
  const ops = new Operations(db, store, config);
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const project = await ops.executeOperation(owner, "projects.create", {
    name: "Example project",
    origins: ["https://example.test"],
  });
  const configure = () =>
    ops.executeOperation(owner, "notifications.configure", {
      revision: 0,
      enabled: true,
      transport: {
        provider: "smtp",
        host: "smtp.example.test",
        port: 465,
        user: "synthetic-user",
        password: "synthetic-password",
      },
      identity: { fromName: "Feedbacks", fromEmail: "feedbacks@example.test" },
      templates: {},
    });
  const subscribe = (
    events = ["created", "reply", "mention", "status", "assignment"],
    includeContent = false,
  ) =>
    ops.executeOperation(owner, "notifications.subscribe", {
      projectId: project.id,
      events,
      includeSelf: true,
      includeContent,
      revision: 0,
    });
  const create = () =>
    ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Private feedback title",
      context: { url: "https://example.test/", viewport: { width: 1280, height: 800 } },
      idempotencyKey: randomUUID(),
    });
  return {
    pg,
    db,
    config,
    store,
    objects,
    ops,
    owner,
    project,
    configure,
    subscribe,
    create,
  };
}

test("email is opt-in, secrets stay encrypted, and worker accepts a single private message", async () => {
  const f = await fixture();
  try {
    await f.create();
    assert.equal(
      (await f.db.one("SELECT count(*)::integer n FROM notification_deliveries")).n,
      0,
    );
    const settings = await f.configure();
    assert.equal(settings.provider, "smtp");
    assert.ok(!JSON.stringify(settings).includes("synthetic-password"));
    const stored = await f.db.one(
      "SELECT * FROM notification_settings WHERE scope='server'",
    );
    assert.ok(!JSON.stringify(stored).includes("synthetic-password"));
    await f.subscribe();
    const thread = await f.create();
    const sent: any[] = [];
    await deliverNotifications(
      f.db,
      f.config,
      f.store,
      async (transport, identity, mail) => {
        assert.equal(transport.provider, "smtp");
        assert.equal(identity.fromEmail, "feedbacks@example.test");
        sent.push(mail);
      },
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "owner@example.test");
    assert.ok(!sent[0].text.includes("Private feedback title"));
    assert.ok(sent[0].text.includes(`/threads/${thread.id}`));
    await deliverNotifications(f.db, f.config, f.store, async () => {
      throw Error("Must not resend");
    });
    assert.equal(
      (await f.db.one("SELECT status FROM notification_deliveries")).status,
      "accepted",
    );
    const history = await f.ops.executeOperation(f.owner, "notifications.deliveries", {
      projectId: f.project.id,
    });
    assert.ok(outputSchemas["notifications.deliveries"].safeParse(history).success);
  } finally {
    await f.pg.close();
  }
});

test("subscription/access revocation and disabled provider suppress queued notifications", async () => {
  const f = await fixture();
  try {
    await f.configure();
    const sub = await f.subscribe();
    await f.create();
    await f.ops.executeOperation(f.owner, "notifications.subscribe", {
      projectId: f.project.id,
      events: [],
      includeSelf: false,
      includeContent: false,
      revision: sub.revision,
    });
    let sent = 0;
    await deliverNotifications(f.db, f.config, f.store, async () => {
      sent++;
    });
    assert.equal(sent, 0);
    assert.equal(
      (await f.db.one("SELECT status FROM notification_deliveries")).status,
      "suppressed",
    );
    await f.db.query("UPDATE notification_subscriptions SET events=$1", [
      JSON.stringify(["created"]),
    ]);
    await f.create();
    await f.db.query("UPDATE users SET active=false WHERE id=$1", [f.owner.userId]);
    await deliverNotifications(f.db, f.config, f.store, async () => {
      sent++;
    });
    assert.equal(sent, 0);
  } finally {
    await f.pg.close();
  }
});

test("discussion and mentions are deduplicated and respect excerpt consent", async () => {
  const f = await fixture();
  try {
    await f.configure();
    await f.subscribe(["reply", "mention"], true);
    const thread = await f.create();
    const payload = {
      threadId: thread.id,
      revision: thread.revision,
      body: "Discussion excerpt",
      mentions: [f.owner.userId],
      idempotencyKey: "synthetic-email-reply",
    };
    await f.ops.executeOperation(f.owner, "threads.reply", payload);
    await f.ops.executeOperation(f.owner, "threads.reply", payload);
    const rows = await f.db.query("SELECT * FROM notification_deliveries");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, "mention");
    const mails: any[] = [];
    await deliverNotifications(
      f.db,
      f.config,
      f.store,
      async (_transport, _identity, mail) => {
        mails.push(mail);
      },
    );
    assert.equal(mails.length, 1);
    assert.ok(mails[0].text.includes("Discussion excerpt"));
  } finally {
    await f.pg.close();
  }
});

test("uncertain sends and interrupted leases are held while explicit rejection can retry", async () => {
  const f = await fixture();
  try {
    await f.configure();
    await f.subscribe();
    await f.create();
    let calls = 0;
    await deliverNotifications(f.db, f.config, f.store, async () => {
      calls++;
      throw new MailSendError("RESPONSE_UNKNOWN", "uncertain");
    });
    const held = await f.db.one("SELECT * FROM notification_deliveries");
    assert.equal(held.status, "uncertain");
    await deliverNotifications(f.db, f.config, f.store, async () => {
      calls++;
    });
    assert.equal(calls, 1);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "notifications.reconcile", {
        projectId: f.project.id,
        deliveryId: held.id,
        revision: held.revision,
        decision: "retry",
      }),
      { code: "VALIDATION" },
    );
    await f.ops.executeOperation(f.owner, "notifications.reconcile", {
      projectId: f.project.id,
      deliveryId: held.id,
      revision: held.revision,
      decision: "retry",
      confirmedNotAccepted: true,
    });
    await deliverNotifications(f.db, f.config, f.store, async () => {
      throw new MailSendError("THROTTLED", "retry");
    });
    assert.equal(
      (await f.db.one("SELECT status FROM notification_deliveries")).status,
      "pending",
    );
    await f.db.query(
      "UPDATE notification_deliveries SET status='sending',lease_until=now()-interval '1 second'",
    );
    await deliverNotifications(f.db, f.config, f.store, async () => {
      calls++;
    });
    assert.equal(
      (await f.db.one("SELECT status FROM notification_deliveries")).status,
      "uncertain",
    );
    assert.equal(calls, 1);
  } finally {
    await f.pg.close();
  }
});

test("settings/template inheritance and revisions enforce current authority", async () => {
  const f = await fixture();
  try {
    await f.configure();
    const global = await f.ops.executeOperation(f.owner, "notifications.settings", {});
    const overridden = await f.ops.executeOperation(f.owner, "notifications.configure", {
      projectId: f.project.id,
      revision: 0,
      enabled: true,
      templates: { created: { subject: "Project: {{project}}", text: "{{threadUrl}}" } },
    });
    assert.equal(overridden.inherited, true);
    assert.equal(overridden.effectiveTemplates.created.subject, "Project: {{project}}");
    assert.equal(
      overridden.effectiveTemplates.reply.subject,
      global.effectiveTemplates.reply.subject,
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "notifications.configure", {
        projectId: f.project.id,
        revision: 0,
        enabled: false,
        templates: {},
      }),
      { code: "CONFLICT" },
    );
    const agent = { ...f.owner, id: "agent", kind: "agent", ownerAdmin: true };
    await assert.rejects(
      notificationOperation(
        f.db,
        f.store,
        f.config,
        agent as any,
        "notifications.settings",
        {},
      ),
    );
    assert.ok(!agentOperations.some((name) => name.startsWith("notifications.")));
    const loaded = await loadMailTransport(f.db, f.config, f.store, f.project.id);
    assert.equal(loaded?.transport.provider, "smtp");
    await f.ops.executeOperation(f.owner, "notifications.configure", {
      revision: global.revision,
      enabled: false,
      templates: {},
    });
    assert.equal(await loadMailTransport(f.db, f.config, f.store, f.project.id), null);
  } finally {
    await f.pg.close();
  }
});

test("templates do not evaluate code, inject headers, or use unknown variables", () => {
  assert.throws(() => renderMailTemplate({ subject: "{{password}}", text: "hello" }, {}));
  assert.throws(() =>
    renderMailTemplate(
      { subject: "{{constructor.constructor('return process')()}}", text: "hello" },
      {},
    ),
  );
  const mail = renderMailTemplate(defaultTemplates.created, {
    project: "Project\r\nBcc: someone@example.test",
    event: "New feedback",
    actor: "<script>text</script>",
  });
  assert.ok(!/[\r\n]/.test(mail.subject));
  assert.ok(mail.text.includes("<script>text</script>"));
  assert.equal(
    inputSchemas["notifications.preview"].safeParse({
      event: "created",
      template: { subject: "a\r\nBcc: x", text: "test" },
    }).success,
    false,
  );
});

test("project sender overrides inherit credentials without exposing or copying secrets", async () => {
  const f = await fixture();
  try {
    await f.configure();
    await f.ops.executeOperation(f.owner, "notifications.configure", {
      projectId: f.project.id,
      revision: 0,
      enabled: true,
      templates: {},
      identity: { fromEmail: "technology@example.test", fromName: "Project team" },
    });
    const loaded = await loadMailTransport(f.db, f.config, f.store, f.project.id);
    assert.equal(loaded?.identity.fromEmail, "technology@example.test");
    assert.equal(loaded?.transport.provider, "smtp");
    const row = await f.db.one(
      "SELECT transport,envelope,key_object FROM notification_settings WHERE project_id=$1",
      [f.project.id],
    );
    assert.equal(row.transport, null);
    assert.equal(row.envelope, null);
    assert.equal(row.key_object, null);
  } finally {
    await f.pg.close();
  }
});

test("Compose blank optional email variables use SMTP defaults and permit SES server roles", async () => {
  const f = await fixture();
  try {
    await seedMailEnvironment(f.db, f.store, f.config, {
      FEEDBACKS_MAIL_PROVIDER: "smtp",
      MAIL_FROM_EMAIL: "sender@example.test",
      MAIL_FROM_NAME: "",
      MAIL_REPLY_TO: "",
      MAIL_SMTP_HOST: "smtp.example.test",
      MAIL_SMTP_PORT: "",
      MAIL_SMTP_USER: "synthetic",
      MAIL_SMTP_PASSWORD: "synthetic password ",
    });
    const smtp = await loadMailTransport(f.db, f.config, f.store);
    assert.equal(smtp?.identity.fromName, "Feedbacks");
    assert.equal(smtp?.transport.provider, "smtp");
    assert.equal((smtp?.transport as any).port, 587);
    assert.equal((smtp?.transport as any).password, "synthetic password ");
    await f.db.query("DELETE FROM notification_settings");
    await seedMailEnvironment(f.db, f.store, f.config, {
      FEEDBACKS_MAIL_PROVIDER: "ses",
      MAIL_FROM_EMAIL: "sender@example.test",
      MAIL_FROM_NAME: "",
      MAIL_SES_REGION: "us-east-1",
      MAIL_SES_ACCESS_KEY_ID: "",
      MAIL_SES_SECRET_ACCESS_KEY: "",
      MAIL_SES_SESSION_TOKEN: "",
      MAIL_SES_CONFIGURATION_SET: "",
    });
    const ses = await loadMailTransport(f.db, f.config, f.store);
    assert.equal(ses?.transport.provider, "ses");
    assert.equal((ses?.transport as any).authMode, "role");
    assert.equal((ses?.transport as any).accessKeyId, undefined);
  } finally {
    await f.pg.close();
  }
});

test("SES authentication can switch to the server role and clear a temporary token on key rotation", async () => {
  const f = await fixture();
  try {
    const identity = { fromName: "Feedbacks", fromEmail: "sender@example.test" };
    let settings = await f.ops.executeOperation(f.owner, "notifications.configure", {
      revision: 0,
      enabled: true,
      templates: {},
      identity,
      transport: {
        provider: "ses",
        authMode: "keys",
        region: "us-east-1",
        accessKeyId: "first-key",
        secretAccessKey: "first-secret",
        sessionToken: "temporary-token",
      },
    });
    assert.equal(settings.sesAuthMode, "keys");
    settings = await f.ops.executeOperation(f.owner, "notifications.configure", {
      revision: settings.revision,
      enabled: true,
      templates: {},
      identity,
      transport: {
        provider: "ses",
        authMode: "keys",
        region: "us-east-1",
        accessKeyId: "replacement-key",
        secretAccessKey: "replacement-secret",
      },
    });
    let loaded = await loadMailTransport(f.db, f.config, f.store);
    assert.equal((loaded?.transport as any).accessKeyId, "replacement-key");
    assert.equal((loaded?.transport as any).sessionToken, undefined);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "notifications.configure", {
        revision: settings.revision,
        enabled: true,
        templates: {},
        identity,
        transport: {
          provider: "ses",
          authMode: "keys",
          region: "us-east-1",
          accessKeyId: "partial-key",
        },
      }),
      { code: "VALIDATION" },
    );
    settings = await f.ops.executeOperation(f.owner, "notifications.configure", {
      revision: settings.revision,
      enabled: true,
      templates: {},
      identity,
      transport: { provider: "ses", authMode: "role", region: "us-east-1" },
    });
    loaded = await loadMailTransport(f.db, f.config, f.store);
    assert.equal(settings.sesAuthMode, "role");
    assert.equal((loaded?.transport as any).accessKeyId, undefined);
    assert.equal((loaded?.transport as any).secretAccessKey, undefined);
    assert.equal((loaded?.transport as any).sessionToken, undefined);
    assert.ok(outputSchemas["notifications.settings"].safeParse(settings).success);
  } finally {
    await f.pg.close();
  }
});

test("credential loading cannot retain revoked project access or a stale account email", async () => {
  const f = await fixture();
  try {
    await f.configure();
    const member = await f.ops.executeOperation(f.owner, "members.create", {
      name: "Reviewer",
      email: "reviewer@example.test",
      password: "Correct-Horse-Battery-123",
      grants: [{ projectId: f.project.id, role: "reviewer" }],
    });
    await f.db.query("UPDATE users SET must_change_password=false WHERE id=$1", [
      member.id,
    ]);
    const actor = {
      ...f.owner,
      id: member.id,
      userId: member.id,
      owner: false,
      primaryOwner: false,
      name: "Reviewer",
    };
    await f.ops.executeOperation(actor, "notifications.subscribe", {
      projectId: f.project.id,
      events: ["created"],
      includeSelf: false,
      includeContent: true,
      revision: 0,
    });
    async function whileOpening(change: () => Promise<unknown>) {
      let opened!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => (opened = resolve));
      const barrier = new Promise<void>((resolve) => (release = resolve));
      const original = f.store.get;
      let hold = true;
      f.store.get = async (key) => {
        if (hold) {
          hold = false;
          opened();
          await barrier;
        }
        return original(key);
      };
      const sent: any[] = [];
      const work = deliverNotifications(
        f.db,
        f.config,
        f.store,
        async (_transport, _identity, mail) => {
          sent.push(mail);
        },
      );
      await started;
      try {
        await change();
      } finally {
        release();
      }
      await work;
      f.store.get = original;
      return sent;
    }
    await f.create();
    assert.equal(
      (
        await whileOpening(() =>
          f.ops.executeOperation(f.owner, "members.grant", {
            projectId: f.project.id,
            userId: member.id,
            role: "reviewer",
            remove: true,
          }),
        )
      ).length,
      0,
    );
    await f.ops.executeOperation(f.owner, "members.grant", {
      projectId: f.project.id,
      userId: member.id,
      role: "reviewer",
      remove: false,
    });
    await f.create();
    const sent = await whileOpening(() =>
      f.db.query("UPDATE users SET email='current@example.test' WHERE id=$1", [
        member.id,
      ]),
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "current@example.test");
    await f.create();
    assert.equal(
      (
        await whileOpening(() =>
          f.ops.executeOperation(actor, "notifications.subscribe", {
            projectId: f.project.id,
            events: [],
            includeSelf: false,
            includeContent: false,
            revision: 1,
          }),
        )
      ).length,
      0,
    );
  } finally {
    await f.pg.close();
  }
});

test("a replaced provider or template is reopened after credential loading before sending", async () => {
  const f = await fixture();
  try {
    await f.configure();
    await f.subscribe();
    await f.create();
    const original = f.store.get;
    let opened!: () => void,
      release!: () => void,
      hold = true;
    const started = new Promise<void>((resolve) => (opened = resolve));
    const barrier = new Promise<void>((resolve) => (release = resolve));
    f.store.get = async (key) => {
      if (hold) {
        hold = false;
        opened();
        await barrier;
      }
      return original(key);
    };
    const sent: any[] = [];
    const work = deliverNotifications(
      f.db,
      f.config,
      f.store,
      async (_transport, identity, mail) => {
        sent.push({ identity, mail });
      },
    );
    await started;
    await f.ops.executeOperation(f.owner, "notifications.configure", {
      revision: 1,
      enabled: true,
      identity: { fromEmail: "replacement@example.test", fromName: "New sender" },
      templates: { created: { subject: "Updated template", text: "{{threadUrl}}" } },
    });
    release();
    await work;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].identity.fromEmail, "replacement@example.test");
    assert.equal(sent[0].mail.subject, "Updated template");
  } finally {
    await f.pg.close();
  }
});

test("a completed old lease cannot finalize a reconciled newer send attempt", async () => {
  const f = await fixture();
  try {
    await f.configure();
    await f.subscribe();
    await f.create();
    let firstStarted!: () => void,
      firstRelease!: () => void,
      secondStarted!: () => void,
      secondRelease!: () => void;
    const startedA = new Promise<void>((resolve) => (firstStarted = resolve));
    const barrierA = new Promise<void>((resolve) => (firstRelease = resolve));
    const startedB = new Promise<void>((resolve) => (secondStarted = resolve));
    const barrierB = new Promise<void>((resolve) => (secondRelease = resolve));
    const first = deliverNotifications(f.db, f.config, f.store, async () => {
      firstStarted();
      await barrierA;
    });
    await startedA;
    await f.db.query(
      "UPDATE notification_deliveries SET lease_until=now()-interval '1 second'",
    );
    await deliverNotifications(f.db, f.config, f.store, async () => {
      throw Error("Unknown outcome must not automatically resend");
    });
    const held = await f.db.one("SELECT * FROM notification_deliveries");
    await f.ops.executeOperation(f.owner, "notifications.reconcile", {
      projectId: f.project.id,
      deliveryId: held.id,
      revision: held.revision,
      decision: "retry",
      confirmedNotAccepted: true,
    });
    const second = deliverNotifications(f.db, f.config, f.store, async () => {
      secondStarted();
      await barrierB;
      throw new MailSendError("SECOND_UNKNOWN", "uncertain");
    });
    await startedB;
    firstRelease();
    await first;
    assert.equal(
      (await f.db.one("SELECT status FROM notification_deliveries")).status,
      "sending",
    );
    secondRelease();
    await second;
    assert.equal(
      (await f.db.one("SELECT status FROM notification_deliveries")).status,
      "uncertain",
    );
  } finally {
    await f.pg.close();
  }
});

test("reply events identify their exact comment despite timestamp order and assignment cancellation is delivered", async () => {
  const f = await fixture();
  try {
    await f.configure();
    await f.subscribe(["mention", "assignment"], true);
    const thread = await f.create();
    let current = await f.ops.executeOperation(f.owner, "threads.reply", {
      threadId: thread.id,
      revision: thread.revision,
      body: "Earlier mention",
      mentions: [f.owner.userId],
      idempotencyKey: randomUUID(),
    });
    await f.db.query(
      "UPDATE replies SET created_at=now()+interval '1 hour' WHERE thread_id=$1",
      [thread.id],
    );
    current = await f.ops.executeOperation(f.owner, "threads.reply", {
      threadId: thread.id,
      revision: current.revision,
      body: "No mention",
      mentions: [],
      idempotencyKey: randomUUID(),
    });
    current = await f.ops.executeOperation(f.owner, "threads.reply", {
      threadId: thread.id,
      revision: current.revision,
      body: "Exact new mention",
      mentions: [f.owner.userId],
      idempotencyKey: randomUUID(),
    });
    const mentions = await f.db.query(
      "SELECT payload FROM notification_deliveries WHERE event='mention' ORDER BY created_at,id",
    );
    assert.equal(mentions.length, 2);
    assert.deepEqual(
      new Set(mentions.map((row) => row.payload.comment)),
      new Set(["Earlier mention", "Exact new mention"]),
    );
    const requests = {
      threadId: thread.id,
      threadRevision: current.revision,
      annotationIds: [],
      userId: f.owner.userId,
      summary: "Review work",
      category: "general",
      tags: [],
      githubDecision: "not_needed",
      githubRationale: "Small repair",
    };
    const assigned = await f.ops.executeOperation(f.owner, "assignments.assign", {
      ...requests,
      idempotencyKey: randomUUID(),
    });
    await f.ops.executeOperation(f.owner, "assignments.cancel", {
      delegationId: assigned.id,
      revision: assigned.revision,
      reason: "Replanned",
      idempotencyKey: randomUUID(),
    });
    await f.ops.executeOperation(f.owner, "assignments.assign", {
      ...requests,
      idempotencyKey: randomUUID(),
    });
    assert.equal(
      (
        await f.db.one(
          "SELECT count(*)::integer n FROM notification_deliveries WHERE event='assignment'",
        )
      ).n,
      3,
    );
  } finally {
    await f.pg.close();
  }
});

test("Mailjet uses CustomID and holds ambiguous HTTP outcomes without a prohibited message header", async () => {
  const original = globalThis.fetch;
  const identity = { fromEmail: "sender@example.test", fromName: "Feedbacks" };
  const mail = {
    to: "recipient@example.test",
    subject: "Synthetic",
    text: "Synthetic",
    messageId: "<stable@example.test>",
  };
  const transport = {
    provider: "mailjet" as const,
    apiKey: "synthetic-key",
    apiSecret: "synthetic-secret",
  };
  try {
    let payload: any;
    globalThis.fetch = async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), {
        status: 200,
      });
    };
    await sendMail(transport, identity, mail);
    assert.equal(payload.Messages[0].CustomID, mail.messageId);
    assert.equal(payload.Messages[0].Headers, undefined);
    for (const [status, disposition] of [
      [429, "retry"],
      [503, "uncertain"],
      [401, "failed"],
    ] as const) {
      globalThis.fetch = async () => new Response("", { status });
      await assert.rejects(
        sendMail(transport, identity, mail),
        (error: any) =>
          error instanceof MailSendError && error.disposition === disposition,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
