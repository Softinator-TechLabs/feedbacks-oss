import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { apiClient } from "../src/cli/client.js";

test("local asset downloads stay on the configured origin, reject redirects and enforce streaming bounds", async () => {
  const oldUrl = process.env.FEEDBACKS_URL,
    oldToken = process.env.FEEDBACKS_TOKEN;
  let mode = "ok",
    requests = 0;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.headers.authorization, "Bearer synthetic-export-token");
    if (mode === "redirect") {
      res.writeHead(302, { location: "/redirect-target" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type":
        mode === "wrong-type"
          ? "text/html"
          : mode === "image"
            ? "image/webp"
            : "video/webm",
    });
    res.write("first");
    res.end("second");
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    process.env.FEEDBACKS_URL = `http://127.0.0.1:${(server.address() as any).port}`;
    process.env.FEEDBACKS_TOKEN = "synthetic-export-token";
    const client = await apiClient();
    const id = "22222222-2222-4222-8222-222222222222";
    assert.equal((await client.downloadAsset(id, 100)).toString(), "firstsecond");
    await assert.rejects(client.downloadAsset(id, 5), /limit/);
    mode = "wrong-type";
    await assert.rejects(client.downloadAsset(id, 100), /download failed/);
    mode = "image";
    assert.equal(
      (await client.downloadAsset(id, 100, "image/webp")).toString(),
      "firstsecond",
    );
    await assert.rejects(client.downloadAsset(id, 100), /download failed/);
    mode = "redirect";
    const before = requests;
    await assert.rejects(client.downloadAsset(id, 100));
    assert.equal(requests, before + 1);
    await assert.rejects(client.downloadAsset("../../escape", 100), /Invalid/);
    assert.equal(requests, before + 1);
  } finally {
    if (oldUrl === undefined) delete process.env.FEEDBACKS_URL;
    else process.env.FEEDBACKS_URL = oldUrl;
    if (oldToken === undefined) delete process.env.FEEDBACKS_TOKEN;
    else process.env.FEEDBACKS_TOKEN = oldToken;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
