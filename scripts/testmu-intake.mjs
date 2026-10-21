import { sendTestMuIntake } from "./lib/testmu-intake.mjs";
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 20000)
      throw Error(
        "Use a reviewed report of at most 20 KB; raw logs and screenshots are not accepted",
      );
  }
  const result = await sendTestMuIntake({
    serverOrigin: process.env.FEEDBACKS_URL,
    token: process.env.FEEDBACKS_TOKEN,
    projectId: process.env.FEEDBACKS_PROJECT_ID,
    report: JSON.parse(input),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(
    (error?.name === "ZodError"
      ? "Invalid reviewed TestMu report. Check its documented version 1 schema."
      : (error?.message ?? "TestMu intake failed")) + "\n",
  );
  process.exitCode = 1;
}
