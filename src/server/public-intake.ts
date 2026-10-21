import { createHmac, randomUUID } from "node:crypto";
import type { Actor } from "../shared/contracts.js";
import {
  intakeConfig,
  intakeInputs,
  type IntakeSubmission,
} from "../shared/contracts/domains/intake.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { access, event } from "./access.js";
import { hash, publicActor } from "./auth.js";
import { fail } from "./errors.js";
import { requireTurnstile } from "./guest-links.js";
import { viewContext } from "./views.js";

export async function manageIntake(
  db: Database,
  actor: Actor,
  operation: string,
  input: any,
  config: Config,
) {
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A signed-in human maintainer must manage public intake", 403);
  const project = await access(db, actor, input.projectId, "maintain");
  const current = await db.one(
    "SELECT * FROM public_intake WHERE project_id=$1 FOR UPDATE",
    [input.projectId],
  );
  if (operation === "intake.save") {
    if ((current?.revision ?? 0) !== input.revision)
      fail("CONFLICT", "Public intake changed; reload before saving", 409);
    const settings = intakeConfig.parse(input.config);
    if (input.enabled) {
      requireTurnstile(config);
      if (
        project.captureMode === "any" ||
        settings.origins.some((origin) => !project.origins?.includes(origin))
      )
        fail(
          "VALIDATION",
          "Approve each exact origin in Project settings before enabling public intake",
        );
    }
    if (current)
      await db.query(
        "UPDATE public_intake SET enabled=$2,data=$3,revision=revision+1,updated_at=now() WHERE project_id=$1",
        [input.projectId, input.enabled, JSON.stringify(settings)],
      );
    else
      await db.query(
        "INSERT INTO public_intake(project_id,id,enabled,data) VALUES($1,$2,$3,$4)",
        [input.projectId, randomUUID(), input.enabled, JSON.stringify(settings)],
      );
    await event(db, actor, input.projectId, input.projectId, "intake.configured", {
      enabled: input.enabled,
    });
  }
  const saved = await db.one("SELECT * FROM public_intake WHERE project_id=$1", [
    input.projectId,
  ]);
  return {
    configured: !!saved,
    id: saved?.id ?? null,
    revision: saved?.revision ?? 0,
    enabled: saved?.enabled ?? false,
    config: saved?.data ?? null,
    snippet: saved
      ? `<script async src="${config.appOrigin}/widget.js" data-intake="${saved.id}"></script>`
      : null,
  };
}

export async function intakeInstallation(
  db: Database,
  intakeId: string,
  origin: string,
  lock = false,
) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(intakeId))
    fail("INVALID_INTAKE", "This feedback form is unavailable", 410);
  const row = await db.one(
    `SELECT i.*,p.data AS project FROM public_intake i JOIN projects p ON p.id=i.project_id WHERE i.id=$1 AND i.enabled=true ${lock ? "FOR UPDATE OF i,p" : ""}`,
    [intakeId],
  );
  if (!row) fail("INVALID_INTAKE", "This feedback form is unavailable", 410);
  if (
    row.project.captureMode === "any" ||
    !row.project.origins?.includes(origin) ||
    !row.data.origins.includes(origin)
  )
    fail("ORIGIN_DENIED", "This website is not approved for public feedback", 403);
  return row;
}
export function inspectIntake(row: any, config: Config) {
  const { siteKey } = requireTurnstile(config);
  const { label, position, color, privacyText, privacyUrl, collectContact } =
    intakeConfig.parse(row.data);
  return {
    label,
    position,
    color,
    privacyText,
    privacyUrl,
    collectContact,
    turnstileSiteKey: siteKey,
  };
}

/** Durable fixed-window limits count attempts, including invalid challenges. No raw IP is retained. */
export async function intakeBudget(
  db: Database,
  config: Config,
  row: any,
  ip: string,
  action: "ingress" | "submit",
  at = Date.now(),
) {
  const { secretKey } = requireTurnstile(config);
  const address = createHmac("sha256", secretKey).update(ip).digest("hex");
  const specs: Array<[string, number, number]> =
    action === "ingress"
      ? [
          [`intake:${row.id}:ingress`, 60000, 300],
          [`intake:${row.id}:ip:${address}:ingress`, 60000, 60],
        ]
      : [
          [`intake:${row.id}:daily`, 86400000, row.data.dailyLimit],
          [`intake:${row.id}:submit`, 60000, 20],
          [`intake:${row.id}:ip:${address}:submit`, 600000, 5],
        ];
  // Exhaust global installation limits before allocating caller-specific keys;
  // rotating addresses cannot grow the counter table past an exhausted budget.
  // Each committed counter remains counted even when another budget is exhausted.
  for (const [key, duration, limit] of specs) {
    const bucket = new Date(Math.floor(at / duration) * duration).toISOString();
    const allowed = await db.one(
      `INSERT INTO public_intake_budgets(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key,bucket) DO UPDATE SET count=public_intake_budgets.count+1 WHERE public_intake_budgets.count<$3 RETURNING count`,
      [key, bucket, limit],
    );
    if (!allowed)
      fail(
        "RATE_LIMITED",
        "This form has reached its request limit. Try again later.",
        429,
      );
  }
  await db.query(
    "DELETE FROM public_intake_budgets WHERE (key,bucket) IN (SELECT key,bucket FROM public_intake_budgets WHERE bucket < now()-interval '2 days' ORDER BY bucket LIMIT 100)",
  );
}

export async function submitIntake(
  db: Database,
  input: IntakeSubmission,
  origin: string,
) {
  const row = await intakeInstallation(db, input.intakeId, origin, true);
  const page = new URL(input.url);
  if (
    !["http:", "https:"].includes(page.protocol) ||
    page.origin !== origin ||
    page.username ||
    page.password
  )
    fail("ORIGIN_DENIED", "The feedback page must match this website", 403);
  if (input.website)
    fail("VERIFICATION_FAILED", "The feedback form could not be verified", 403);
  if (input.contact && !row.data.collectContact)
    fail("VALIDATION", "Contact sharing is disabled for this website");
  page.search = "";
  page.hash = "";
  const payload = {
    name: input.name,
    body: input.body,
    url: page.toString(),
    viewport: input.viewport,
    ...(input.element ? { element: input.element } : {}),
    ...(input.contact ? { contact: input.contact } : {}),
  };
  const inputHash = hash(JSON.stringify(payload));
  const prior = await db.one(
    "SELECT input_hash FROM public_intake_receipts WHERE intake_id=$1 AND request_id=$2",
    [input.intakeId, input.requestId],
  );
  if (prior) {
    if (prior.input_hash !== inputHash)
      fail("CONFLICT", "This request was already used for different feedback", 409);
    return { posted: true as const };
  }
  // Keep idempotency receipts while the permanent installation exists. They have
  // no thread content or contact data; deleting a thread cannot recreate it on retry.
  const author: Actor = {
    id: row.id,
    userId: row.id,
    kind: "guest",
    name: input.name || "Website visitor",
    owner: false,
  };
  const actor = publicActor(author),
    now = new Date().toISOString(),
    id = randomUUID();
  const context = {
    ...viewContext(
      {
        url: payload.url,
        viewport: {
          width: Math.max(100, input.viewport.width),
          height: Math.max(100, input.viewport.height),
        },
      },
      row.project,
    ),
    source: "public_intake",
    viewportKnown: true,
    intake: {
      installationId: row.id,
      kind: input.element ? "element" : "page",
      ...(input.element ? { element: input.element } : {}),
      ...(input.contact
        ? { contact: { email: input.contact.email, sharedAt: now } }
        : {}),
    },
  };
  await db.query("INSERT INTO threads(id,project_id,data) VALUES($1,$2,$3)", [
    id,
    row.project_id,
    JSON.stringify({
      body: input.body,
      category: "general",
      tags: [],
      context,
      author: actor,
      lastActor: actor,
      lastActivityAt: now,
      archived: false,
      response: {
        state: "unanswered",
        lastHumanRequest: { actor, at: now },
        lastResponse: null,
      },
      work: { state: "open", history: [] },
      review: { round: 1, state: "open", history: [] },
      externalIssues: [],
      fixEvidence: [],
      trust: "untrusted_discussion",
    }),
  ]);
  await db.query(
    "INSERT INTO public_intake_receipts(intake_id,request_id,input_hash) VALUES($1,$2,$3)",
    [input.intakeId, input.requestId, inputHash],
  );
  await event(db, author, row.project_id, id, "thread.created", {
    revision: 1,
    intake: true,
  });
  return { posted: true as const };
}

export const publicIntakeInputs = {
  inspect: intakeInputs["intake.inspect"],
  submit: intakeInputs["intake.submit"],
};
