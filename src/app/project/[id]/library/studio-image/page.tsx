'use client'

import MediaBrowser from '@/components/media/MediaBrowser'

// Image Studio 전용 라이브러리 — Image Studio (이미지 생성) 페이지에서 만든
// 단일 이미지 결과만 모아서 봅니다. (대본 비독립 — 씬 컨텍스트 없이도 조회)
export default function StudioImageLibraryPage() {
  return <MediaBrowser type="t2i" lockSource="studio" />
}
