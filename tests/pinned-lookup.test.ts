import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { pinnedLookup } from "../src/server/webhooks.js";

test("pinned DNS lookup works with Node's all-address HTTP connection", async () => {
  const server = createServer((_req, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Expected TCP server");
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(
        `http://pinned.invalid:${address.port}/`,
        {
          autoSelectFamily: true,
          lookup: pinnedLookup({ address: "127.0.0.1", family: 4 }),
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => resolve(Buffer.concat(chunks).toString()));
          response.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(body, "ok");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
