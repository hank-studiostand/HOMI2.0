// 씬 넘버를 자연 숫자로 정렬하는 유틸.
//
// 예: "3-1-1" < "23-1-1" 이 정확히 맞도록.
// 문자열 비교만 하면 "23-1-1" < "3-1-1" 이 되어 버림 (앞 자릿수 비교).
//
// 각 part를 숫자로 파싱해 튜플로 비교한다.
// 비숫자(예: "1a")가 섞이면 NaN으로 떨어지므로 fallback으로 string 비교.

export function parseSceneParts(sceneNumber: string): number[] {
  if (!sceneNumber) return [Number.MAX_SAFE_INTEGER]
  const parts = sceneNumber.split('-')
  const out: number[] = []
  for (const p of parts) {
    const n = parseInt(p, 10)
    out.push(Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER)
  }
  return out
}

export function compareSceneNumbers(a: string, b: string): number {
  const pa = parseSceneParts(a)
  const pb = parseSceneParts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? -1
    const y = pb[i] ?? -1
    if (x !== y) return x - y
  }
  return 0
}

export function sortScenesByNumber<T extends { scene_number?: string; order_index?: number }>(scenes: T[]): T[] {
  // 1) scene_number 자연 정렬 우선
  // 2) 같으면 order_index fallback
  return [...scenes].sort((a, b) => {
    const cmp = compareSceneNumbers(a.scene_number ?? '', b.scene_number ?? '')
    if (cmp !== 0) return cmp
    return (a.order_index ?? 0) - (b.order_index ?? 0)
  })
}
