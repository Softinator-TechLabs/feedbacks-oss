import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../server/errors.js";
import { DIAGNOSTIC_CHUNK_BYTES } from "../shared/screenshot-diagnostics.js";

export async function apiClient() {
  let config: { url?: string; token?: string } = {};
  if (!process.env.FEEDBACKS_TOKEN) {
    const file =
      process.env.FEEDBACKS_CONFIG ??
      join(homedir(), ".config", "feedbacks", "config.json");
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size > 16384 ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw new DomainError(
          "CONFIG",
          "Credential config must be an owned regular file with mode 0600",
          400,
        );
      config = JSON.parse(await handle.readFile("utf8"));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new DomainError("CONFIG", "Cannot read private credential config", 400);
    } finally {
      await handle?.close();
    }
  }
  const token = process.env.FEEDBACKS_TOKEN ?? config.token;
  if (typeof token !== "string" || !token.trim())
    throw new DomainError("CONFIG", "Set FEEDBACKS_TOKEN or a private config token", 400);
  const configuredUrl = process.env.FEEDBACKS_URL ?? config.url;
  if (!configuredUrl)
    throw new DomainError("CONFIG", "Set FEEDBACKS_URL or a private config url", 400);
  const url = new URL(configuredUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new DomainError(
      "CONFIG",
      "Use an HTTPS server origin (HTTP allowed only on loopback)",
      400,
    );
  const execute = async (name: string, input: unknown) => {
    const response = await fetch(new URL(`/api/${name}`, url), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    const body = await response.json();
    if (!response.ok || !body.ok)
      throw new DomainError(
        body.error?.code ?? "HTTP_ERROR",
        body.error?.message ?? "Request failed",
        response.status,
        body.error?.details,
      );
    return body.data;
  };
  return Object.assign(execute, {
    async downloadDiagnosticChunk(evidenceId: string, fileId: string, sequence: number) {
      const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      if (
        !uuid.test(evidenceId) ||
        !uuid.test(fileId) ||
        !Number.isSafeInteger(sequence) ||
        sequence < 0
      )
        throw new DomainError("VALIDATION", "Invalid diagnostic chunk selector", 400);
      const response = await fetch(
        new URL(`/api/diagnostics/${evidenceId}/files/${fileId}/chunks/${sequence}`, url),
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        },
      );
      if (
        !response.ok ||
        !response.body ||
        response.headers.get("content-type")?.split(";")[0] !== "application/octet-stream"
      ) {
        await response.body?.cancel();
        throw new DomainError(
          "DIAGNOSTIC_DOWNLOAD",
          "Authorized diagnostic chunk download failed",
          response.status || 502,
        );
      }
      const lengthHeader = response.headers.get("content-length");
      const declaredLength = lengthHeader === null ? null : Number(lengthHeader);
      if (declaredLength !== null && declaredLength > DIAGNOSTIC_CHUNK_BYTES) {
        await response.body.cancel();
        throw new DomainError(
          "DIAGNOSTIC_DOWNLOAD",
          "Diagnostic chunk exceeds 2 MiB",
          413,
        );
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > DIAGNOSTIC_CHUNK_BYTES)
            throw new DomainError(
              "DIAGNOSTIC_DOWNLOAD",
              "Diagnostic chunk exceeds 2 MiB",
              413,
            );
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      if (declaredLength !== null && declaredLength !== length)
        throw new DomainError(
          "DIAGNOSTIC_DOWNLOAD",
          "Diagnostic chunk length mismatch",
          502,
        );
      return Buffer.concat(chunks);
    },
    async downloadAsset(
      assetId: string,
      maxBytes: number,
      contentType: "video/webm" | "image/webp" = "video/webm",
    ) {
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          assetId,
        ) ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        maxBytes > 100 * 1024 * 1024 ||
        !["video/webm", "image/webp"].includes(contentType)
      )
        throw new DomainError("VALIDATION", "Invalid asset download", 400);
      const response = await fetch(new URL(`/api/assets/${assetId}`, url), {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      if (
        !response.ok ||
        !response.body ||
        response.headers.get("content-type")?.split(";")[0] !== contentType
      ) {
        await response.body?.cancel();
        throw new DomainError(
          "ASSET_DOWNLOAD",
          "Authorized media download failed",
          response.status || 502,
        );
      }
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > maxBytes) {
        await response.body.cancel();
        throw new DomainError("ASSET_DOWNLOAD", "Media exceeds local export limit", 413);
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes)
            throw new DomainError(
              "ASSET_DOWNLOAD",
              "Media exceeds local export limit",
              413,
            );
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    },
  });
}
