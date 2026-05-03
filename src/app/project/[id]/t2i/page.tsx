'use client'

import MediaBrowser from '@/components/media/MediaBrowser'

// /t2i — 프로젝트의 모든 T2I 결과를 한눈에 보는 라이브러리.
// 씬 카드 그리드는 /scenes에 있음.
export default function T2IPage() {
  return <MediaBrowser type="t2i" />
}
