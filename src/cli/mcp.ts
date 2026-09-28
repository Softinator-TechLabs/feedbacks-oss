import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mcpServer } from "../server/mcp.js";
import { apiClient } from "./client.js";
try {
  const profile = process.env.FEEDBACKS_MCP_PROFILE ?? "full";
  if (profile !== "full" && profile !== "compact") throw new Error("Invalid MCP profile");
  const server = mcpServer(await apiClient(), profile);
  await server.connect(new StdioServerTransport());
} catch {
  // Invalid URLs/configuration can carry secrets in native error objects.
  process.stderr.write(
    "Feedbacks MCP connection failed; check private configuration and server connection.\n",
  );
  process.exitCode = 1;
}
