import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  serverExternalPackages: ['@modelcontextprotocol/sdk'],
};

export default nextConfig;
