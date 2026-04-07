import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    turbopack: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/**',
      },
    ],
  },
}

export default nextConfig
