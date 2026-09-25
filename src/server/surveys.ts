import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import type { Actor } from "../shared/contracts.js";
import { access, event } from "./access.js";
import { hash, secret } from "./auth.js";
import { fail } from "./errors.js";
import { requireTurnstile } from "./guest-links.js";

type Question = {
  id: string;
  type: "nps" | "rating" | "single_choice" | "text";
  prompt: string;
  required: boolean;
  options?: string[];
};
type Definition = { title: string; description: string; questions: Question[] };

const serial = (row: any) => ({
  id: row.id,
  ...row.definition,
  expiresAt: new Date(row.expires_at).toISOString(),
  revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  responses: row.responses,
  maxResponses: row.max_responses,
});

export async function manageSurveys(
  db: Database,
  actor: Actor,
  op: string,
  input: any,
  config: Config,
) {
  if (op === "surveys.revoke" || op === "surveys.results") {
    const row = await db.one("SELECT * FROM surveys WHERE id=$1", [input.surveyId]);
    if (!row) fail("NOT_FOUND", "Survey not found", 404);
    await access(db, actor, row.project_id, "maintain");
    if (op === "surveys.results") {
      const responses = await db.query(
        "SELECT answers FROM survey_responses WHERE survey_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1000",
        [row.id],
      );
      const questions = (row.definition as Definition).questions.map((question) => {
        const counts: Record<string, number> = {};
        const answers: string[] = [];
        for (const response of responses) {
          const answer = response.answers[question.id];
          if (answer === undefined) continue;
          if (question.type === "text") {
            if (answers.length < 100) answers.push(answer);
          } else {
            const key = String(answer);
            counts[key] = (counts[key] ?? 0) + 1;
          }
        }
        const answered = Object.values(counts).reduce((a, b) => a + b, 0);
        const nps =
          question.type === "nps" && answered
            ? Math.round(
                (100 *
                  ((counts["9"] ?? 0) +
                    (counts["10"] ?? 0) -
                    Array.from(
                      { length: 7 },
                      (_, score) => counts[String(score)] ?? 0,
                    ).reduce((a, b) => a + b, 0))) /
                  answered,
              )
            : null;
        return {
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          counts,
          nps,
          answers,
        };
      });
      return { surveyId: row.id, total: row.responses, questions };
    }
    if (actor.kind !== "human")
      fail("FORBIDDEN", "A project maintainer must revoke surveys", 403);
    await db.query(
      "UPDATE surveys SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1",
      [row.id],
    );
    await event(db, actor, row.project_id, row.id, "survey.revoked", {});
    return { revoked: true };
  }
  await access(db, actor, input.projectId, "maintain");
  if (op === "surveys.list") {
    const rows = await db.query(
      "SELECT * FROM surveys WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [input.projectId],
    );
    return { items: rows.map(serial) };
  }
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A project maintainer must create surveys", 403);
  requireTurnstile(config);
  const active = await db.one(
    "SELECT count(*)::integer AS count FROM surveys WHERE project_id=$1 AND revoked_at IS NULL AND expires_at>now() AND responses<max_responses",
    [input.projectId],
  );
  if (active.count >= 10)
    fail("LIMIT_REACHED", "Revoke an active survey before creating another", 429);
  const id = randomUUID();
  const token = secret();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86400000).toISOString();
  const definition: Definition = {
    title: input.title,
    description: input.description,
    questions: input.questions,
  };
  await db.query(
    "INSERT INTO surveys(id,project_id,token_hash,definition,created_by,expires_at,max_responses) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      input.projectId,
      hash(token),
      JSON.stringify(definition),
      actor.userId,
      expiresAt,
      input.maxResponses,
    ],
  );
  await event(db, actor, input.projectId, id, "survey.created", {
    expiresAt,
    maxResponses: input.maxResponses,
  });
  return { id, token, path: `/survey#token=${token}`, expiresAt };
}

async function liveSurvey(db: Database, token: string, lock = false) {
  const row = await db.one(
    `SELECT s.*,p.data AS project FROM surveys s JOIN projects p ON p.id=s.project_id
     WHERE s.token_hash=$1 ${lock ? "FOR UPDATE OF s" : ""}`,
    [hash(token)],
  );
  if (!row) fail("INVALID_LINK", "This survey link is no longer available", 410);
  return row;
}

export async function surveyInspect(db: Database, token: string, config: Config) {
  const { siteKey } = requireTurnstile(config);
  const row = await liveSurvey(db, token);
  if (
    row.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    row.responses >= row.max_responses
  )
    fail("INVALID_LINK", "This survey link is no longer available", 410);
  return {
    projectName: row.project.name,
    ...row.definition,
    expiresAt: new Date(row.expires_at).toISOString(),
    turnstileSiteKey: siteKey,
  };
}

function validateAnswers(questions: Question[], answers: Record<string, unknown>) {
  const known = new Set(questions.map((question) => question.id));
  if (Object.keys(answers).some((id) => !known.has(id)))
    fail("VALIDATION", "An answer does not match this survey");
  for (const question of questions) {
    const value = answers[question.id];
    if (value === undefined) {
      if (question.required) fail("VALIDATION", `Answer ${question.id} is required`);
      continue;
    }
    const valid =
      question.type === "text"
        ? typeof value === "string" && value.trim().length > 0 && value.length <= 500
        : question.type === "single_choice"
          ? typeof value === "string" && !!question.options?.includes(value)
          : typeof value === "number" &&
            Number.isInteger(value) &&
            value >= (question.type === "nps" ? 0 : 1) &&
            value <= (question.type === "nps" ? 10 : 5);
    if (!valid) fail("VALIDATION", `Invalid answer for ${question.id}`);
  }
}

export async function surveySubmit(
  db: Database,
  input: {
    token: string;
    answers: Record<string, unknown>;
    responseKey: string;
  },
) {
  const row = await liveSurvey(db, input.token, true);
  const keyHash = hash(input.responseKey);
  const previous = await db.one(
    "SELECT answers FROM survey_responses WHERE survey_id=$1 AND response_key_hash=$2",
    [row.id, keyHash],
  );
  if (previous) {
    const canonical = (answers: Record<string, unknown>) =>
      JSON.stringify(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)));
    if (canonical(previous.answers) !== canonical(input.answers))
      fail("CONFLICT", "This response was already submitted with different answers", 409);
    return { posted: true };
  }
  if (
    row.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    row.responses >= row.max_responses
  )
    fail("INVALID_LINK", "This survey link is no longer available", 410);
  validateAnswers((row.definition as Definition).questions, input.answers);
  await db.query(
    "INSERT INTO survey_responses(id,survey_id,response_key_hash,answers) VALUES($1,$2,$3,$4)",
    [randomUUID(), row.id, keyHash, JSON.stringify(input.answers)],
  );
  await db.query("UPDATE surveys SET responses=responses+1 WHERE id=$1", [row.id]);
  return { posted: true };
}
