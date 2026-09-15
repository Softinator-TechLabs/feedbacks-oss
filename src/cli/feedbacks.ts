import { operationDescriptions } from "../shared/operation-descriptions.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { businessOperations, operationRegistry } from "../shared/contracts.js";
import { DomainError } from "../server/errors.js";
import { apiClient } from "./client.js";

try {
  const args = process.argv.slice(2);
  let data: unknown;
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    data = {
      usage:
        "npm run --silent cli -- <operation> [--input file.json]; JSON input defaults to stdin (empty input means {}). --list; --describe <operation>",
      credentials:
        "FEEDBACKS_TOKEN environment or owned mode-0600 ~/.config/feedbacks/config.json with {url,token}; FEEDBACKS_URL and FEEDBACKS_CONFIG override defaults. Never put secrets in arguments.",
    };
  } else if (args.length === 1 && args[0] === "--list") {
    data = {
      operations: businessOperations.map((name) => ({
        name,
        readOnly: operationRegistry[name].readOnly,
      })),
    };
  } else if (
    args.length === 2 &&
    args[0] === "--describe" &&
    businessOperations.includes(args[1] as any)
  ) {
    const entry = operationRegistry[args[1]];
    data = {
      name: args[1],
      description: operationDescriptions[args[1]] ?? `Feedbacks ${args[1]}`,
      readOnly: entry.readOnly,
      inputSchema: z.toJSONSchema(entry.input),
      outputSchema: z.toJSONSchema(entry.output),
    };
  } else {
    const [name, flag, file] = args;
    if (
      !businessOperations.includes(name as any) ||
      !(args.length === 1 || (args.length === 3 && flag === "--input" && file))
    )
      throw new DomainError(
        "USAGE",
        "Use <operation> [--input file.json], --list or --describe <operation>",
        400,
      );
    let raw = "";
    if (file) raw = await readFile(file, "utf8");
    else if (!process.stdin.isTTY) {
      for await (const chunk of process.stdin) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 20 * 1024 * 1024)
          throw new DomainError("VALIDATION", "Input exceeds 20 MiB", 413);
      }
    }
    const parsed = operationRegistry[name].input.safeParse(
      JSON.parse(raw.trim() || "{}"),
    );
    if (!parsed.success)
      throw new DomainError(
        "VALIDATION",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
        400,
      );
    const execute = await apiClient();
    data = await execute(name, parsed.data);
    if (!operationRegistry[name].output.safeParse(data).success)
      throw new DomainError(
        "PROTOCOL",
        "Server returned an invalid operation result",
        502,
      );
  }
  process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
} catch (error) {
  const e =
    error instanceof DomainError
      ? error
      : new DomainError(
          "CLIENT_ERROR",
          "Request failed; check JSON input, private configuration and server connection",
          500,
        );
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: { code: e.code, message: e.message } })}\n`,
  );
  process.exitCode = 1;
}
