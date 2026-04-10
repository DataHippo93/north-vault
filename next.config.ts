import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/**',
      },
    ],
  },
  serverExternalPackages: ['@vladmandic/face-api', '@tensorflow/tfjs', 'canvas', 'sharp', 'pdfjs-dist', '@huggingface/transformers'],
}

export default nextConfig
