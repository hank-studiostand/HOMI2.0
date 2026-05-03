'use client'

import MediaBrowser from '@/components/media/MediaBrowser'

// /i2v — 프로젝트의 모든 I2V 결과를 한눈에 보는 라이브러리.
// 씬 카드 그리드는 /scenes에 있음.
export default function I2VPage() {
  return <MediaBrowser type="i2v" />
}
