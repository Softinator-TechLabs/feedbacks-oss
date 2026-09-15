import { z } from "zod";

export interface Config {
  appOrigin: string;
  production: boolean;
  port: number;
  databaseUrl: string;
  assetDriver: "s3" | "local";
  assetDirectory: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  organizationId: string;
  trustProxyHops: number;
  databasePoolMax: number;
}

const integer = (value: string | undefined, fallback: number, max: number, min = 1) =>
  z.coerce
    .number()
    .int()
    .min(min)
    .max(max)
    .parse(value ?? fallback);

export function configFromEnv(env = process.env): Config {
  const production = env.NODE_ENV === "production";
  const appOrigin = z.url().parse(env.APP_ORIGIN ?? "http://localhost:3000");
  const url = new URL(appOrigin);
  if (
    url.origin !== appOrigin ||
    !["http:", "https:"].includes(url.protocol) ||
    (production && url.protocol !== "https:")
  )
    throw new Error("APP_ORIGIN must be an exact HTTP origin, HTTPS in production");
  const assetDriver = z
    .enum(["s3", "local"])
    .parse(env.ASSET_DRIVER ?? (production ? "s3" : "local"));
  if (production && assetDriver !== "s3")
    throw new Error("Production requires private S3 storage");
  if (assetDriver === "s3") {
    for (const name of [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ])
      if (!env[name]?.trim()) throw new Error(`Missing ${name}`);
    const endpoint = new URL(env.S3_ENDPOINT!);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (production
        ? endpoint.protocol !== "https:"
        : !["http:", "https:"].includes(endpoint.protocol))
    )
      throw new Error(
        "S3_ENDPOINT must use HTTPS in production and contain no credentials or query",
      );
  }
  if (production && !env.ORGANIZATION_ID)
    throw new Error("Set a unique ORGANIZATION_ID for this deployment");
  return {
    appOrigin,
    production,
    port: integer(env.PORT, 3000, 65535),
    databaseUrl: z.string().min(1).parse(env.DATABASE_URL),
    assetDriver,
    assetDirectory: env.ASSET_DIRECTORY ?? ".local/assets",
    s3Endpoint: env.S3_ENDPOINT,
    s3Region: env.S3_REGION,
    s3Bucket: env.S3_BUCKET,
    s3AccessKey: env.S3_ACCESS_KEY_ID,
    s3SecretKey: env.S3_SECRET_ACCESS_KEY,
    organizationId: z
      .uuid()
      .parse(env.ORGANIZATION_ID ?? "00000000-0000-4000-8000-000000000001"),
    trustProxyHops: integer(env.TRUST_PROXY_HOPS, 0, 10, 0),
    databasePoolMax: integer(env.DATABASE_POOL_MAX, 10, 100),
  };
}
