/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['better-sqlite3', '@qoder-ai/qoder-agent-sdk', 'bcrypt'],
  },
};

export default nextConfig;
