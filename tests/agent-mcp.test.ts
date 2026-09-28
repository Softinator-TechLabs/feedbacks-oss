import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mcpServer } from "../src/server/mcp.js";
import { DomainError } from "../src/server/errors.js";

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

test("compact MCP offers seven tools, native images, text fallback, guides and scoped failures", async () => {
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
    assert.equal(tools.tools.length, 7);
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
