/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', '@qoder-ai/qoder-agent-sdk', 'bcrypt'],
};

export default nextConfig;
