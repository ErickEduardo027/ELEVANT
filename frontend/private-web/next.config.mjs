/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
  transpilePackages: ['@elevant/api-client'],
};

export default nextConfig;
