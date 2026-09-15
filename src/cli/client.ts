import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../server/errors.js";

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
  return async (name: string, input: unknown) => {
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
      );
    return body.data;
  };
}
