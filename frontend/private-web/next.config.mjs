import { fileURLToPath } from 'node:url';

const monorepoRoot = fileURLToPath(new URL('../../', import.meta.url));
const deploymentId = process.env.ELEVANT_DEPLOYMENT_ID;
if (deploymentId !== undefined && !/^[0-9a-f]{40}$/.test(deploymentId)) {
  throw new Error('ELEVANT_DEPLOYMENT_ID must be a canonical source commit.');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  deploymentId,
  generateBuildId: async () => deploymentId ?? 'local-development',
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: false,
  images: { unoptimized: true },
  transpilePackages: ['@elevant/api-client'],
  turbopack: { root: monorepoRoot },
  async redirects() {
    return [
      { source: '/index.html', destination: '/login', permanent: true },
      { source: '/dashboard.html', destination: '/admin-occ/dashboard', permanent: true },
      { source: '/contracts.html', destination: '/contratos', permanent: true },
      { source: '/finance.html', destination: '/finanzas', permanent: true },
    ];
  },
};

export default nextConfig;
