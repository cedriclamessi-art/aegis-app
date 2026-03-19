/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ['prisma', '@prisma/client'],
  },
};

module.exports = nextConfig;
