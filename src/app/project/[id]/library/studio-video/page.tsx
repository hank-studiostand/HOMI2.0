'use client'

import MediaBrowser from '@/components/media/MediaBrowser'

// Video Studio 전용 라이브러리 — Video Studio (영상 생성) 페이지에서 만든
// 단일 영상 결과만 모아서 봅니다. (대본 비독립 — 씬 컨텍스트 없이도 조회)
export default function StudioVideoLibraryPage() {
  return <MediaBrowser type="i2v" lockSource="studio" />
}
