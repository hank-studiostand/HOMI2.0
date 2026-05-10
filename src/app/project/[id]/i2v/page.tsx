'use client'

import MediaBrowser from '@/components/media/MediaBrowser'

// /i2v — Shot Workspace 씬별 영상 결과 라이브러리.
// Video Studio (대본 비독립) 결과는 /library/studio-video 에서 별도로 조회.
export default function I2VPage() {
  return <MediaBrowser type="i2v" lockSource="workspace" />
}
