import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  Client as ModernClient,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { mcpServer } from "../src/server/mcp.js";
import { DomainError } from "../src/server/errors.js";

test("only a local adapter exposes materialization and returns a real path receipt", async () => {
  for (const local of [false, true]) {
    let requested: unknown;
    const server = mcpServer(
      async () => ({}),
      "compact",
      local
        ? {
            materialize: async (input) => {
              requested = input;
              return {
                directory: "/tmp/feedbacks-recording-test",
                readme: "/tmp/feedbacks-recording-test/README.md",
                manifest: "/tmp/feedbacks-recording-test/manifest.json",
                recordingId: "8c06f94d-fca6-4333-84b7-671e560812bc",
                eventCount: 3,
                complete: true,
                warnings: [],
                files: ["README.md"],
              };
            },
          }
        : {},
    );
    const client = new Client({ name: "local-recording", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      const found = (await client.listTools()).tools.find(
        (tool) => tool.name === "feedbacks_recording_materialize",
      );
      assert.equal(!!found, local);
      if (local) {
        assert.equal(found!.annotations?.readOnlyHint, false);
        const result = await client.callTool({
          name: found!.name,
          arguments: { recordingId: "8c06f94d-fca6-4333-84b7-671e560812bc" },
        });
        assert.equal(
          (result.structuredContent as any).directory,
          "/tmp/feedbacks-recording-test",
        );
        assert.deepEqual(requested, {
          recordingId: "8c06f94d-fca6-4333-84b7-671e560812bc",
          includeVideo: true,
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  }
});

for (const profile of ["full", "compact"] as const)
  test(`modern ${profile} MCP retains native images, schema validation and scoped errors`, async () => {
    const handler = createMcpHandler(
      () =>
        mcpServer(async (name) => {
          if (name !== "assets.get") throw new DomainError("FORBIDDEN", "denied", 403);
          return {
            id: "8c06f94d-fca6-4333-84b7-671e560812bc",
            captureId: "8c06f94d-fca6-4333-84b7-671e560812bc",
            rendition: "screenshot",
            bytes: 5,
            contentType: "image/webp",
            createdAt: "2026-09-28T00:00:00Z",
            url: "/api/assets/example",
            image: {
              data: "aW1hZ2U=",
              mimeType: "image/webp",
              width: 100,
              height: 300,
              sourceWidth: 1000,
              sourceHeight: 3000,
            },
          };
        }, profile),
      { legacy: "reject" },
    );
    const client = new ModernClient(
      { name: "modern-image-schema", version: "1" },
      { versionNegotiation: { mode: "auto" } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
          fetch: (url, init) => handler.fetch(new Request(url, init)),
        }),
      );
      assert.equal(client.getProtocolEra(), "modern");
      await client.listTools();
      const name = profile === "compact" ? "feedbacks_asset" : "assets.get";
      const result = await client.callTool({
        name,
        arguments: {
          assetId: "8c06f94d-fca6-4333-84b7-671e560812bc",
          includeImage: true,
        },
      });
      assert.equal((result.structuredContent as any).preview.sourceHeight, 3000);
      assert.deepEqual(result.content[1], {
        type: "image",
        data: "aW1hZ2U=",
        mimeType: "image/webp",
      });
      assert.ok(!(result.content[0] as any).text.includes("aW1hZ2U="));
      const invalid = await client.callTool({ name, arguments: { assetId: "invalid" } });
      assert.equal(invalid.isError, true);
      const denied = await client.callTool({
        name: profile === "compact" ? "feedbacks_queue" : "threads.list",
        arguments: { projectId: "8c06f94d-fca6-4333-84b7-671e560812bc" },
      });
      assert.equal(denied.isError, true);
      assert.match((denied.content[0] as any).text, /FORBIDDEN/);
    } finally {
      await client.close();
      await handler.close();
    }
  });

test("full-profile image preview validates against its advertised output schema", async () => {
  const server = mcpServer(async () => ({
    id: "8c06f94d-fca6-4333-84b7-671e560812bc",
    captureId: "8c06f94d-fca6-4333-84b7-671e560812bc",
    rendition: "screenshot",
    bytes: 5,
    contentType: "image/webp",
    createdAt: "2026-09-28T00:00:00Z",
    url: "/api/assets/example",
    image: {
      data: "aW1hZ2U=",
      mimeType: "image/webp",
      width: 100,
      height: 300,
      sourceWidth: 1000,
      sourceHeight: 3000,
    },
  }));
  const client = new Client({ name: "full-image-schema", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    await client.listTools();
    const result = await client.callTool({
      name: "assets.get",
      arguments: { assetId: "8c06f94d-fca6-4333-84b7-671e560812bc", includeImage: true },
    });
    assert.equal((result.structuredContent as any).preview.sourceHeight, 3000);
    assert.equal((result.content as any)[1].type, "image");
  } finally {
    await client.close();
    await server.close();
  }
});

test("compact MCP offers eight tools, native images, text fallback, guides and scoped failures", async () => {
  const execute = async (name: string) => {
    if (name === "assets.get")
      return {
        id: "8c06f94d-fca6-4333-84b7-671e560812bc",
        width: 1000,
        height: 3000,
        image: {
          data: "aW1hZ2U=",
          mimeType: "image/webp",
          width: 100,
          height: 300,
          sourceWidth: 1000,
          sourceHeight: 3000,
        },
      };
    throw new DomainError("FORBIDDEN", "denied", 403);
  };
  const server = mcpServer(execute, "compact");
  const client = new Client({ name: "small-context-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 8);
    assert.ok(client.getInstructions()?.includes("Feedbacks"));
    const guide = await client.callTool({
      name: "feedbacks_guide",
      arguments: { topic: "glossary" },
    });
    assert.equal(
      JSON.parse((guide.content as any)[0].text).path,
      "references/glossary.md",
    );
    const result = await client.callTool({
      name: "feedbacks_asset",
      arguments: { assetId: "8c06f94d-fca6-4333-84b7-671e560812bc", includeImage: true },
    });
    assert.equal((result.content as any)[1].type, "image");
    assert.ok(!(result.content as any)[0].text.includes("aW1hZ2U="));
    assert.equal((result.structuredContent as any).preview.height, 300);
    const denied = await client.callTool({
      name: "feedbacks_queue",
      arguments: { projectId: "8c06f94d-fca6-4333-84b7-671e560812bc" },
    });
    assert.equal(denied.isError, true);
    assert.equal((await client.listResources()).resources.length, 6);
    assert.equal((await client.listPrompts()).prompts[0].name, "review-feedback");
    const resource = await client.readResource({ uri: "feedbacks://guide/start" });
    assert.ok((resource.contents[0] as any).text.includes("createdAfter"));
  } finally {
    await client.close();
    await server.close();
  }
});

for (const profile of ["full", "compact"] as const)
  test(`${profile} exposes the same task entry tools without repeated workflow text`, async () => {
    const server = mcpServer(async () => ({}), profile);
    const client = new Client({ name: "task-entry", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const name of [
        "feedbacks_start",
        "feedbacks_thread",
        "feedbacks_asset",
        "feedbacks_describe",
        "feedbacks_guide",
      ])
        assert.ok(names.includes(name), name);
      if (profile === "full") assert.ok(names.includes("threads.get"));
      assert.ok((client.getInstructions() ?? "").length < 1000);
    } finally {
      await client.close();
      await server.close();
    }
  });

test("MCP errors preserve actionable scope information", async () => {
  const server = mcpServer(async () => {
    throw new DomainError("FORBIDDEN", "Missing scope: recordings.list", 403, {
      operation: "recordings.list",
      requiredScopes: ["recordings.list"],
      recovery: "Create a replacement key in Account.",
    });
  }, "compact");
  const client = new Client({ name: "scope-errors", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    await client.listTools();
    const result = await client.callTool({
      name: "feedbacks_execute",
      arguments: {
        operation: "recordings.list",
        input: { threadId: "8c06f94d-fca6-4333-84b7-671e560812bc" },
      },
    });
    assert.equal(result.isError, true);
    assert.deepEqual((result._meta as any).error.requiredScopes, ["recordings.list"]);
    assert.match((result.content[0] as any).text, /replacement key/);
    assert.equal(
      JSON.parse((result.content[0] as any).text).error.operation,
      "recordings.list",
    );
  } finally {
    await client.close();
    await server.close();
  }
});
