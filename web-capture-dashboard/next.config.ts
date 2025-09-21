import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'aware-gerbil-139.convex.cloud',
        port: '',
        pathname: '/api/storage/**',
      },
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
