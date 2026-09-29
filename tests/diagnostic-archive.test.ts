import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { createApp } from "../src/server/app.js";
import { diagnosticFixture, hashDiagnostic } from "./diagnostic-fixture.js";

function untar(bytes: Buffer) {
  const files = new Map<string, Buffer>();
  for (let at = 0; at + 512 <= bytes.length; ) {
    const block = bytes.subarray(at, at + 512);
    const name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const size = Number.parseInt(
      block.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(),
      8,
    );
    files.set(name, bytes.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

test("authorized tar.gz download preserves full DOM and uses only generated safe names", async () => {
  const raw = Buffer.from(
    `${"x".repeat(5 * 1024 * 1024)}é<script>alert(1)</script>../escape`,
  );
  const f = await diagnosticFixture(raw);
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    await f.upload();
    server = createApp(f.config, f.db, f.store as any).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const token = await f.ops.auth.issueToken(f.db, f.owner, {
      name: "Archive reader",
      projectIds: [f.project.id],
      scopes: ["diagnostics.describe", "diagnostics.read"],
      expiresInDays: 30,
    });
    const response = await fetch(`${base}/api/diagnostics/${f.evidenceId}/archive`, {
      headers: { Authorization: `Bearer ${token.token}` },
      redirect: "error",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/gzip/);
    const files = untar(gunzipSync(Buffer.from(await response.arrayBuffer())));
    const domName = `dom/${f.fileId}.html.txt`;
    assert.equal(hashDiagnostic(files.get(domName)!), hashDiagnostic(raw));
    assert.ok(
      [...files.keys()].every((name) => !name.includes("..") && !name.startsWith("/")),
    );
    const single = await fetch(
      `${base}/api/diagnostics/${f.evidenceId}/files/${f.fileId}/chunks/0`,
      {
        headers: { Authorization: `Bearer ${token.token}` },
        redirect: "error",
      },
    );
    assert.equal(single.status, 200);
    assert.deepEqual(
      Buffer.from(await single.arrayBuffer()),
      Buffer.from(f.chunks[0].data),
    );
    const login = await fetch(`${base}/api/auth.login`, {
      method: "POST",
      headers: { Origin: f.config.appOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "read-owner@example.test",
        password: "Correct-Horse-Battery-123",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const browserDownload = await fetch(
      `${base}/api/diagnostics/${f.evidenceId}/archive`,
      {
        headers: { Cookie: cookie },
        redirect: "error",
      },
    );
    assert.equal(browserDownload.status, 200);
    assert.equal(
      hashDiagnostic(
        untar(gunzipSync(Buffer.from(await browserDownload.arrayBuffer()))).get(domName)!,
      ),
      hashDiagnostic(raw),
    );
    const noScope = await f.ops.auth.issueToken(f.db, f.owner, {
      name: "No archive grant",
      projectIds: [f.project.id],
      scopes: ["threads.get"],
      expiresInDays: 30,
    });
    const denied = await fetch(`${base}/api/diagnostics/${f.evidenceId}/archive`, {
      headers: { Authorization: `Bearer ${noScope.token}` },
      redirect: "error",
    });
    assert.equal(denied.status, 403);
    const other = await f.ops.executeOperation(f.owner, "projects.create", {
      name: "Unrelated archive project",
      origins: ["https://example.test"],
    });
    const wrongProject = await f.ops.auth.issueToken(f.db, f.owner, {
      name: "Other project",
      projectIds: [other.id],
      scopes: ["diagnostics.read"],
      expiresInDays: 30,
    });
    for (const path of [
      `/api/diagnostics/${f.evidenceId}/archive`,
      `/api/diagnostics/${f.evidenceId}/files/${f.fileId}/chunks/0`,
    ]) {
      const forbidden = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${wrongProject.token}` },
        redirect: "error",
      });
      assert.equal(forbidden.status, 403);
    }
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await f.close();
  }
});
