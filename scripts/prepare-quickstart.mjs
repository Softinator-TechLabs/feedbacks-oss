// Promote only a published, multi-platform stable image to the fresh-install channel.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function releaseMetadata(tag, revision, release, image, compose) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    throw new Error("Use a stable vMAJOR.MINOR.PATCH tag.");
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Use a full Compose commit SHA.");
  if (
    release.tagName !== tag ||
    release.isDraft !== false ||
    release.isPrerelease !== false
  )
    throw new Error("The application release must already be public and stable.");
  const digest = image.match(/^Digest:\s+(sha256:[a-f0-9]{64})$/m)?.[1];
  if (!digest || !image.includes("linux/amd64") || !image.includes("linux/arm64"))
    throw new Error("Verify the published multi-platform image first.");
  if (!compose.includes("feedbacks-assets") || !compose.includes("ASSET_DRIVER: local"))
    throw new Error("Expected the local-volume quickstart Compose.");
  return `version=${tag.slice(1)}\nimage=softinator/feedbacks@${digest}\ncompose_sha256=${createHash("sha256").update(compose).digest("hex")}\ncompose_revision=${revision}\n`;
}

async function main() {
  const [tag, revision] = process.argv.slice(2);
  if (
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "") ||
    !/^[a-f0-9]{40}$/.test(revision ?? "")
  )
    throw new Error(
      "Usage: node scripts/prepare-quickstart.mjs vMAJOR.MINOR.PATCH COMPOSE_COMMIT_SHA",
    );
  const release = JSON.parse(
    execFileSync(
      "gh",
      [
        "release",
        "view",
        tag,
        "--repo",
        "Softinator-TechLabs/feedbacks-oss",
        "--json",
        "tagName,isDraft,isPrerelease",
      ],
      { encoding: "utf8" },
    ),
  );
  const image = execFileSync(
    "docker",
    ["buildx", "imagetools", "inspect", `softinator/feedbacks:${tag.slice(1)}`],
    { encoding: "utf8" },
  );
  const response = await fetch(
    `https://raw.githubusercontent.com/Softinator-TechLabs/feedbacks-oss/${revision}/site/public/compose.quickstart.yaml`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`Compose download failed: HTTP ${response.status}`);
  await writeFile(
    new URL("../site/public/quickstart-stable.txt", import.meta.url),
    releaseMetadata(tag, revision, release, image, await response.text()),
  );
  console.info(
    "Stable metadata prepared. Verify a fresh install, then publish the metadata through a reviewed PR. Existing installations are unchanged.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
