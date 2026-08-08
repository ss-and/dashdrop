/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint is run separately in CI; don't block production builds on it.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["xlsx", "@prisma/client", "bcryptjs"],
};

export default nextConfig;
