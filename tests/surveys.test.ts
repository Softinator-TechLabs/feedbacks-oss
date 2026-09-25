import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { surveyInspect, surveySubmit } from "../src/server/surveys.js";
import { accountLock } from "../src/server/auth.js";
import { createApp } from "../src/server/app.js";

const config: any = {
  appOrigin: "http://127.0.0.1:3000",
  production: false,
  turnstileSiteKey: "1x00000000000000000000AA",
  turnstileSecretKey: "1x0000000000000000000000000000000AA",
};

test("a survey is opt-in, capacity limited, private, and computes NPS from completed responses", async () => {
  const pg = new PGlite();
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(db, {} as any, config);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Product",
      origins: ["https://example.test"],
    });
    const invited = await ops.executeOperation(owner, "members.invite", {
      projectId: project.id,
      email: "reviewer@example.test",
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invited.token, "Reviewer", "Correct-Horse-Battery-123");
    const reviewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const questions = [
      {
        id: "recommend",
        type: "nps",
        prompt: "How likely are you to recommend us?",
        required: true,
      },
      { id: "reason", type: "text", prompt: "Why?", required: false },
      {
        id: "feature",
        type: "single_choice",
        prompt: "Most useful feature?",
        required: true,
        options: ["Capture", "Discuss"],
      },
    ];
    await assert.rejects(
      ops.executeOperation(reviewer, "surveys.create", {
        projectId: project.id,
        title: "Pulse",
        questions,
      }),
      { code: "FORBIDDEN" },
    );
    const survey = await ops.executeOperation(owner, "surveys.create", {
      projectId: project.id,
      title: "Pulse",
      description: "Short product survey",
      questions,
      expiresInDays: 7,
      maxResponses: 4,
    });
    assert.match(survey.path, /^\/survey#token=/);
    assert.ok(survey.token.length > 20);
    const listed = await ops.executeOperation(owner, "surveys.list", {
      projectId: project.id,
    });
    assert.equal(listed.items[0].title, "Pulse");
    assert.ok(!JSON.stringify(listed).includes(survey.token));
    const opened = await surveyInspect(db, survey.token, config);
    assert.deepEqual(opened.questions, questions);
    assert.equal(opened.projectName, "Product");
    server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}/api/survey.inspect`;
    const badOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://other.test" },
      body: JSON.stringify({ token: survey.token }),
    });
    assert.equal(badOrigin.status, 403);
    const publicInspect = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: config.appOrigin },
      body: JSON.stringify({ token: survey.token }),
    });
    assert.equal(publicInspect.status, 200);
    assert.deepEqual((await publicInspect.json()).data, opened);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(url).includes("challenges.cloudflare.com/turnstile")
        ? Promise.resolve(new Response(JSON.stringify({ success: false })))
        : originalFetch(url, init)) as typeof fetch;
    try {
      const failedChallenge = await originalFetch(
        endpoint.replace("survey.inspect", "survey.submit"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: config.appOrigin },
          body: JSON.stringify({
            token: survey.token,
            answers: { recommend: 9, feature: "Capture" },
            responseKey: "http-visitor",
            turnstileToken: "invalid",
          }),
        },
      );
      assert.equal(failedChallenge.status, 403);
      globalThis.fetch = ((url: Parameters<typeof fetch>[0], init?: RequestInit) =>
        String(url).includes("challenges.cloudflare.com/turnstile")
          ? Promise.resolve(new Response(JSON.stringify({ success: true })))
          : originalFetch(url, init)) as typeof fetch;
      const posted = await originalFetch(
        endpoint.replace("survey.inspect", "survey.submit"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: config.appOrigin },
          body: JSON.stringify({
            token: survey.token,
            answers: { recommend: 9, reason: "Clear", feature: "Capture" },
            responseKey: "visitor-one",
            turnstileToken: "synthetic-challenge",
          }),
        },
      );
      assert.equal(posted.status, 200);
      assert.deepEqual((await posted.json()).data, { posted: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    const submit = (answers: Record<string, unknown>, key: string) =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        return surveySubmit(tx, { token: survey.token, answers, responseKey: key });
      });
    await assert.rejects(submit({ recommend: 11, feature: "Capture" }, "invalid-one"), {
      code: "VALIDATION",
    });
    await assert.rejects(submit({ recommend: 9, feature: "Other" }, "invalid-one"), {
      code: "VALIDATION",
    });
    await assert.rejects(
      submit({ recommend: 9, feature: "Capture", extra: "x" }, "invalid-one"),
      { code: "VALIDATION" },
    );
    assert.deepEqual(
      await submit({ recommend: 9, reason: "Clear", feature: "Capture" }, "visitor-one"),
      { posted: true },
    );
    await assert.rejects(
      submit({ recommend: 10, reason: "Changed", feature: "Capture" }, "visitor-one"),
      { code: "CONFLICT" },
    );
    assert.deepEqual(
      await submit({ recommend: 9, reason: "Clear", feature: "Capture" }, "visitor-one"),
      { posted: true },
    );
    assert.deepEqual(await submit({ recommend: 4, feature: "Discuss" }, "visitor-two"), {
      posted: true,
    });
    assert.deepEqual(
      await submit({ recommend: 9, feature: "Capture" }, "visitor-three"),
      {
        posted: true,
      },
    );
    assert.deepEqual(await submit({ recommend: 8, feature: "Discuss" }, "visitor-four"), {
      posted: true,
    });
    await assert.rejects(submit({ recommend: 8, feature: "Capture" }, "visitor-five"), {
      code: "INVALID_LINK",
    });
    const results = await ops.executeOperation(owner, "surveys.results", {
      surveyId: survey.id,
    });
    assert.equal(results.total, 4);
    assert.equal(results.questions[0].nps, 25);
    assert.deepEqual(results.questions[0].counts, { "4": 1, "8": 1, "9": 2 });
    assert.deepEqual(results.questions[2].counts, { Capture: 2, Discuss: 2 });
    assert.equal(results.questions[1].answers[0], "Clear");
    await assert.rejects(
      ops.executeOperation(reviewer, "surveys.results", { surveyId: survey.id }),
      { code: "FORBIDDEN" },
    );
    await ops.executeOperation(owner, "surveys.revoke", { surveyId: survey.id });
    await assert.rejects(surveyInspect(db, survey.token, config), {
      code: "INVALID_LINK",
    });
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
  }
});
