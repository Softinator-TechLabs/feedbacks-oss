import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { GithubApp } from "../src/server/github-app.js";
import { quickIssueDraft } from "../src/server/issue-draft.js";

test("one-click Issue keeps source and media links when feedback is long", () => {
  const id = randomUUID();
  const draft = quickIssueDraft(
    { id, body: "Long feedback ".repeat(900) },
    "https://feedbacks.example.test",
    [
      {
        id: randomUUID(),
        contentType: "video/webm",
        directUrl: "https://s3.example.test/video",
      },
      {
        id: randomUUID(),
        contentType: "image/webp",
        filename: "full-page-001-of-002.webp",
        directUrl: null,
      },
      {
        id: randomUUID(),
        contentType: "image/webp",
        filename: "full-page-002-of-002.webp",
        directUrl: null,
      },
    ],
  );
  assert.ok(draft.body.length <= 8000);
  assert.match(
    draft.body,
    new RegExp(`https://feedbacks\\.example\\.test/threads/${id}`),
  );
  assert.match(draft.body, /https:\/\/s3\.example\.test\/video/);
  assert.match(draft.body, /Full-page capture: 2 numbered images/);
  assert.match(draft.body, /full-page-002-of-002\.webp/);
});

for (const privateRepository of [true, false]) {
  test(`one-click Issue includes safe asset links for ${privateRepository ? "private" : "public"} repository`, async () => {
    const pg = new PGlite();
    const db = new Database(pg as any);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config: any = {
      appOrigin: "https://feedbacks.example.test",
      githubAppId: "123",
      githubAppSlug: "feedbacks-test",
      githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    const created: { title?: string; body?: string } = {};
    let installationAvailable = true;
    const fetcher: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/installation"))
        return installationAvailable
          ? Response.json({ id: 91 })
          : Response.json({}, { status: 404 });
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "installation-token" });
      if (path.endsWith("/issues") && init?.method === "POST") {
        Object.assign(created, JSON.parse(String(init.body)));
        return Response.json({ number: 13 }, { status: 201 });
      }
      if (path.endsWith("/issues/13"))
        return Response.json({
          html_url: "https://github.com/acme/site/issues/13",
          number: 13,
          state: "open",
          body: created.body,
        });
      if (path.endsWith("/repos/acme/site"))
        return Response.json({ private: privateRepository });
      throw new Error(`Unexpected GitHub API ${path}`);
    };
    const signedKeys: string[] = [];
    const store: any = {
      async get() {
        throw new Error("not needed");
      },
      async put() {
        throw new Error("not needed");
      },
      async remove() {
        throw new Error("not needed");
      },
      async signedGetUrl(key: string) {
        signedKeys.push(key);
        return `https://s3.example.test/signed/${encodeURIComponent(key)}`;
      },
    };
    try {
      await migrate(db);
      const ops = new Operations(db, store, config, new GithubApp(config, fetcher));
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Site",
        origins: ["https://example.test"],
        repositoryUrl: "https://github.com/acme/site",
      });
      const beforeConnection = await ops.executeOperation(owner, "github.connection", {
        projectId: project.id,
      });
      assert.equal(beforeConnection.installation, "installed");
      assert.equal(beforeConnection.connected, false);
      const thread = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Checkout breaks @team <script>",
        context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
        idempotencyKey: "github-quick-thread",
      });
      const assetId = randomUUID();
      await db.query(
        "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
        [
          assetId,
          project.id,
          thread.id,
          "private/test-image.webp",
          JSON.stringify({
            contentType: "image/webp",
            width: 100,
            height: 100,
            rendition: "capture",
          }),
        ],
      );
      const connected = await ops.executeOperation(owner, "github.connect", {
        projectId: project.id,
        revision: project.revision,
      });
      assert.equal(connected.githubConnected, true);
      const connection = await ops.executeOperation(owner, "github.connection", {
        projectId: project.id,
      });
      assert.equal(connection.configured, true);
      assert.equal(connection.installation, "installed");
      const input = {
        threadId: thread.id,
        revision: thread.revision,
        idempotencyKey: "github-quick-create-1",
      };
      const token = await ops.executeOperation(owner, "tokens.create", {
        name: "Issue-capable agent",
        projectIds: [project.id],
        scopes: ["github.issueCreate"],
      });
      const agent = await ops.auth.authenticate(token.token);
      await assert.rejects(
        ops.executeOperation(agent, "github.issueCreateQuick", input),
        {
          code: "FORBIDDEN",
        },
      );
      const result = await ops.executeOperation(owner, "github.issueCreateQuick", input);
      assert.match(created.title ?? "", /Checkout breaks/);
      assert.match(
        created.body ?? "",
        /https:\/\/feedbacks\.example\.test\/api\/assets\//,
      );
      assert.match(created.body ?? "", /https:\/\/feedbacks\.example\.test\/threads\//);
      assert.doesNotMatch(created.body ?? "", /<script>|@team/);
      if (privateRepository) {
        assert.match(created.body ?? "", /https:\/\/s3\.example\.test\/signed\//);
        assert.deepEqual(signedKeys, ["private/test-image.webp"]);
      } else {
        assert.doesNotMatch(created.body ?? "", /s3\.example\.test/);
        assert.deepEqual(signedKeys, []);
      }
      assert.equal(
        result.externalIssues[0].url,
        "https://github.com/acme/site/issues/13",
      );
      const replay = await ops.executeOperation(owner, "github.issueCreateQuick", input);
      assert.equal(replay.externalIssues[0].url, result.externalIssues[0].url);
      installationAvailable = false;
      const revoked = await ops.executeOperation(owner, "github.connection", {
        projectId: project.id,
      });
      assert.equal(revoked.installation, "not_installed");
      assert.equal(revoked.connected, true);
    } finally {
      await pg.close();
    }
  });
}
