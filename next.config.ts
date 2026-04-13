import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage (프로젝트 이미지 / 레퍼런스 에셋)
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
      // Kling AI 생성 영상 썸네일 / 이미지
      {
        protocol: 'https',
        hostname: '*.klingai.com',
      },
      {
        protocol: 'https',
        hostname: 'p1.klingai.com',
      },
      // Google AI (Imagen / Gemini 생성 이미지, 임시 URL)
      {
        protocol: 'https',
        hostname: '*.googleapis.com',
      },
    ],
  },
};

export default nextConfig;
