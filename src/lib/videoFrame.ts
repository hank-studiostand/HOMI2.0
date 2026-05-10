// videoFrame.ts — 영상 파일의 첫(또는 임의 시간) 프레임을 JPEG 데이터 URL로 추출.
// Start/End Frame 슬롯에 영상이 들어오면 모델이 image 만 받으니 클라이언트에서 미리 변환.

export async function extractVideoFrame(
  source: File | string,
  opts?: { time?: number; mime?: string; quality?: number }
): Promise<string> {
  const time = opts?.time ?? 0
  const mime = opts?.mime ?? 'image/jpeg'
  const quality = opts?.quality ?? 0.92

  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'

    let revokeUrl: string | null = null
    const cleanup = () => {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl)
      v.removeAttribute('src')
      v.load()
    }

    v.addEventListener('loadeddata', () => {
      // seek to requested time (clamp)
      const target = Math.min(Math.max(0, time), Math.max(0, (v.duration || 0) - 0.05))
      v.currentTime = target
    })
    v.addEventListener('seeked', () => {
      try {
        // Seedance/Kling 입력 한도 회피용 — 최대 변 1280px 로 다운스케일
        const MAX_SIDE = 1280
        const srcW = v.videoWidth || 1280
        const srcH = v.videoHeight || 720
        const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(srcW * scale))
        c.height = Math.max(1, Math.round(srcH * scale))
        const ctx = c.getContext('2d')
        if (!ctx) { cleanup(); reject(new Error('canvas 2D 컨텍스트 없음')); return }
        ctx.drawImage(v, 0, 0, c.width, c.height)
        const dataUrl = c.toDataURL(mime, quality)
        cleanup()
        resolve(dataUrl)
      } catch (e) {
        cleanup()
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    v.addEventListener('error', () => {
      cleanup()
      reject(new Error('영상 로드 실패 (코덱 비호환 또는 CORS 차단 가능)'))
    })

    if (typeof source === 'string') {
      v.src = source
    } else {
      revokeUrl = URL.createObjectURL(source)
      v.src = revokeUrl
    }
    v.load()
  })
}

// 헬퍼 — File 이 영상이면 첫 프레임 추출, 아니면 원래 file을 dataURL 로
export async function fileToFrameOrDataUrl(file: File): Promise<string> {
  if (file.type.startsWith('video/')) {
    return await extractVideoFrame(file, { time: 0 })
  }
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error ?? new Error('FileReader 실패'))
    r.readAsDataURL(file)
  })
}
