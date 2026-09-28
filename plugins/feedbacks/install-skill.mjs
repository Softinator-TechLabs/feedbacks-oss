import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";

const files = [
  "SKILL.md",
  "references/glossary.md",
  "references/media.md",
  "references/workflow.md",
  "references/install.md",
];
const locations = {
  codex: ".agents/skills",
  claude: ".claude/skills",
  antigravity: ".gemini/config/skills",
  "antigravity-cli": ".gemini/antigravity-cli/skills",
};
async function rejectSymlinks(path) {
  const parent = dirname(path);
  if (parent !== path) await rejectSymlinks(parent);
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("Refusing a symbolic-link destination");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
try {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Install the secret-free Feedbacks skills. --client codex|claude|antigravity|antigravity-cli OR --directory /absolute/review-feedback-directory; also installs sibling manage-feedbacks-context; --check (read-only); --replace (explicitly replace differing known files). Does not configure MCP, credentials or hooks. Verify the client/version's skill path before installation.",
    );
  } else {
    let client,
      directory,
      check = false,
      replace = false;
    for (let n = 0; n < args.length; n++) {
      if (args[n] === "--client") client = args[++n];
      else if (args[n] === "--directory") directory = args[++n];
      else if (args[n] === "--check") check = true;
      else if (args[n] === "--replace") replace = true;
      else throw new Error("Unknown option; use --help");
    }
    if (!!client === !!directory || (client && !Object.hasOwn(locations, client)))
      throw new Error("Choose one valid --client or --directory; use --help");
    const target = directory
      ? resolve(directory)
      : join(homedir(), locations[client], "review-feedback");
    await rejectSymlinks(target);
    const contents = [];
    const entries = [
      ...files.map((file) => ({ skill: "review-feedback", file, target })),
      {
        skill: "manage-feedbacks-context",
        file: "SKILL.md",
        target: join(dirname(target), "manage-feedbacks-context"),
      },
    ];
    for (const entry of entries) {
      const { skill, file } = entry;
      const content = await readFile(
        new URL(`skills/${skill}/${file}`, import.meta.url),
        "utf8",
      );
      const destination = join(entry.target, file);
      await rejectSymlinks(destination);
      let existing;
      try {
        existing = await readFile(destination, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      contents.push({
        file: `${skill}/${file}`,
        content,
        destination,
        state:
          existing === undefined
            ? "missing"
            : existing === content
              ? "current"
              : "different",
      });
    }
    if (!check) {
      if (!replace && contents.some((file) => file.state === "different"))
        throw new Error(
          "Existing skill differs; review the diff before explicit --replace",
        );
      for (const file of contents)
        if (file.state !== "current") {
          await mkdir(dirname(file.destination), { recursive: true });
          await writeFile(file.destination, file.content, { mode: 0o600 });
        }
    }
    console.log(
      JSON.stringify({
        mode: check ? "check" : "installed",
        directory: target,
        files: contents.map(({ file, state }) => ({
          file,
          state: check ? state : "current",
        })),
        next: "Reload the actual client and verify review-feedback and manage-feedbacks-context are discovered in a fresh chat; file installation alone does not prove activation.",
      }),
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
