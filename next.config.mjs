/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Hide the floating Next.js dev indicator (the small "N" badge) — it is
  // dev-only, but it clutters the UI while designing.
  devIndicators: false,
  eslint: {
    // Lint is run separately in CI; don't block production builds on it.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["xlsx", "@prisma/client", "bcryptjs"],
};

export default nextConfig;
