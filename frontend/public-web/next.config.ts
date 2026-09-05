import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const monorepoRoot = fileURLToPath(new URL("../../", import.meta.url));
const deploymentId = process.env.ELEVANT_DEPLOYMENT_ID;

if (deploymentId !== undefined && !/^[0-9a-f]{40}$/.test(deploymentId)) {
  throw new Error(
    "ELEVANT_DEPLOYMENT_ID must be the canonical 40-character lowercase source commit.",
  );
}

export function buildContentSecurityPolicy(
  configuredApiOrigin: string | undefined,
  environment = process.env.NODE_ENV,
) {
  const connectSources = ["'self'", configuredApiOrigin]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const scriptSources = ["'self'", "'unsafe-inline'", "blob:"];
  if (environment === "development") scriptSources.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");
}

const nextConfig: NextConfig = {
  deploymentId,
  generateBuildId: async () => deploymentId ?? "local-development",
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@elevant/api-client"],
  async headers() {
    const contentSecurityPolicy = buildContentSecurityPolicy(
      process.env.NEXT_PUBLIC_ELEVANT_API_URL,
    );

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
