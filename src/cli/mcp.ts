import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { mcpServer } from "../server/mcp.js";
import { apiClient } from "./client.js";
import { materializeRecording } from "./recording-materialize.js";
try {
  const profile = process.env.FEEDBACKS_MCP_PROFILE ?? "full";
  if (profile !== "full" && profile !== "compact") throw new Error("Invalid MCP profile");
  const execute = await apiClient();
  serveStdio(() =>
    mcpServer(execute, profile, {
      materialize: (input) =>
        materializeRecording(execute, input, { downloadAsset: execute.downloadAsset }),
    }),
  );
} catch {
  // Invalid URLs/configuration can carry secrets in native error objects.
  process.stderr.write(
    "Feedbacks MCP connection failed; check private configuration and server connection.\n",
  );
  process.exitCode = 1;
}
