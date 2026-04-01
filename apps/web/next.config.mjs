/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode for detecting potential issues
  reactStrictMode: true,

  // Self-contained output for Docker — includes all required server files
  output: 'standalone',

  // Only allow images from trusted domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
    ],
  },

  // Expose only non-secret env vars to the browser
  env: {
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000',
  },

  // Workspace package transpilation (monorepo)
  transpilePackages: ['@codesheriff/shared'],
};

export default nextConfig;
