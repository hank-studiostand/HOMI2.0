'use client'

import MediaBrowser from '@/components/media/MediaBrowser'

// /t2i — Shot Workspace 씬별 이미지 결과 라이브러리.
// Image Studio (대본 비독립) 결과는 /library/studio-image 에서 별도로 조회.
export default function T2IPage() {
  return <MediaBrowser type="t2i" lockSource="workspace" />
}
