import { createHash } from "node:crypto";
import { z } from "zod";
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const testMuReportSchema = z
  .object({
    version: z.literal(1),
    reviewed: z.literal(true),
    buildId: identifier,
    testId: identifier,
    checkpoint: identifier,
    name: z.string().trim().min(1).max(200),
    status: z.enum(["failed", "error"]),
    summary: z.string().trim().min(1).max(8000),
    pageUrl: z.string().url().max(4096),
    sessionUrl: z.string().url().max(4000),
    capturedAt: z.string().datetime(),
    viewport: z
      .object({
        width: z.number().int().min(100).max(20000),
        height: z.number().int().min(100).max(20000),
      })
      .strict(),
  })
  .strict();
export function testMuIntake(projectId, report) {
  z.string().uuid().parse(projectId);
  const value = testMuReportSchema.parse(report),
    page = new URL(value.pageUrl),
    session = new URL(value.sessionUrl);
  if (!["http:", "https:"].includes(page.protocol) || page.username || page.password)
    throw Error("Reviewed page must be an HTTP(S) URL without credentials");
  page.hash = "";
  for (const key of [...page.searchParams.keys()])
    if (
      /token|secret|password|passwd|auth|session|cookie|email|key|code|signature|jwt|credential/i.test(
        key,
      )
    )
      page.searchParams.delete(key);
  page.searchParams.sort();
  const providerHosts = [
    "automation.lambdatest.com",
    "automation.testmuai.com",
    "appautomation.lambdatest.com",
    "appautomation.testmuai.com",
    "hyperexecute.lambdatest.com",
    "hyperexecute.testmuai.com",
  ];
  if (
    session.protocol !== "https:" ||
    session.username ||
    session.password ||
    session.port ||
    !providerHosts.includes(session.hostname) ||
    [...session.searchParams.keys()].some((key) =>
      /token|secret|password|auth|key|signature|credential/i.test(key),
    )
  )
    throw Error("Use the private provider dashboard session URL without an access token");
  const identity = createHash("sha256")
    .update(JSON.stringify([1, projectId, value.buildId, value.testId, value.checkpoint]))
    .digest("hex");
  const input = {
    projectId,
    body: `TestMu ${value.status}: ${value.name}\n\n${value.summary}\n\nBuild: ${value.buildId}\nTest: ${value.testId}\nCheckpoint: ${value.checkpoint}\nProvider session: ${session.toString()}\n\nCI-provided test evidence; verify the report and provider session before acting.`,
    context: {
      url: page.toString(),
      viewport: value.viewport,
      capturedAt: value.capturedAt,
      reproduction: {
        source: "app",
        workspaceId: value.buildId,
        objectId: value.testId,
        view: value.checkpoint,
      },
    },
    category: "general",
    tags: ["testmu", "automated-qa"],
    idempotencyKey: `testmu:v1:${identity}`,
  };
  if (input.body.length > 12000)
    throw Error(
      "Shorten the reviewed summary or provider session link so the report fits within 12000 characters",
    );
  return input;
}
export async function sendTestMuIntake(
  { serverOrigin, token, projectId, report },
  transport = fetch,
) {
  const origin = new URL(serverOrigin);
  if (
    origin.origin !== serverOrigin ||
    origin.username ||
    origin.password ||
    !(
      origin.protocol === "https:" ||
      (origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    )
  )
    throw Error(
      "Feedbacks URL must be an exact HTTPS origin, or loopback HTTP for local development",
    );
  if (typeof token !== "string" || token.length < 20 || token.length > 200)
    throw Error("A scoped Feedbacks API key is required");
  const input = testMuIntake(projectId, report);
  const response = await transport(new URL("/api/threads.create", origin), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true)
    throw Error(
      `Feedbacks rejected intake: ${data.error?.code ?? response.status}. Correct the report or current project/key access, then retry with the same report identity.`,
    );
  return { threadId: data.data.id, revision: data.data.revision };
}
