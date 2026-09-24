import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { S3Assets } from "../src/server/assets.js";
import { configFromEnv } from "../src/server/config.js";

test("S3 adapter uses the configured provider, private bucket path and authenticated PUT/GET", async () => {
  const objects = new Map<string, Buffer>();
  const requests: {
    method: string;
    url: string;
    signed: boolean;
    contentType?: string;
  }[] = [];
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method!,
      url: request.url!,
      signed: request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ") === true,
      contentType: request.headers["content-type"],
    });
    if (request.method === "PUT") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      objects.set(request.url!.split("?")[0], Buffer.concat(chunks));
      response.writeHead(200);
      response.end();
    } else {
      const body = objects.get(request.url!.split("?")[0]);
      if (!body) {
        response.writeHead(404, { "Content-Type": "application/xml" });
        response.end("<Error><Code>NoSuchKey</Code></Error>");
      } else {
        response.writeHead(200, {
          "Content-Type": "image/webp",
          "Content-Length": body.length,
        });
        response.end(body);
      }
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const config = configFromEnv({
    DATABASE_URL: "postgres://localhost/fixture",
    ASSET_DRIVER: "s3",
    S3_ENDPOINT: `http://127.0.0.1:${(server.address() as any).port}`,
    S3_REGION: "test-region-1",
    S3_BUCKET: "private-fixture",
    S3_ACCESS_KEY_ID: "fixture",
    S3_SECRET_ACCESS_KEY: "fixture",
  });
  const store = new S3Assets(config);
  try {
    const bytes = Buffer.from("synthetic-object-bytes");
    await store.put("organizations/fixture/annotated.webp", bytes);
    await store.put("organizations/fixture/tab-video.webm", bytes, "video/webm");
    assert.deepEqual(await store.get("organizations/fixture/annotated.webp"), bytes);
    assert.equal(requests[1].contentType, "video/webm");
    assert.deepEqual(
      requests.map((request) => request.method),
      ["PUT", "PUT", "GET"],
    );
    assert.ok(
      requests.every(
        (request) =>
          request.signed &&
          request.url.startsWith("/private-fixture/organizations/fixture/"),
      ),
    );
    await assert.rejects(store.get("missing.webp"), { name: "NoSuchKey" });
  } finally {
    (store as any).client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
