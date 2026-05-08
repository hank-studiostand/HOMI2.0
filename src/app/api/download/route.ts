import { NextRequest, NextResponse } from 'next/server'

// /api/download?url=<encoded>&name=<filename>
// 외부 이미지/영상 URL을 서버에서 fetch해서 Content-Disposition: attachment 로 다시 내려줌.
// CORS 우회용 — 클라이언트 fetch+blob 대신 이 라우트로 navigate하면 강제 다운로드됨.

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('url')
  const name = req.nextUrl.searchParams.get('name') ?? 'download'

  if (!u) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  // 안전: http(s) 만 허용. 데이터 URL/파일 URL 차단.
  if (!/^https?:\/\//i.test(u)) {
    return NextResponse.json({ error: 'only http/https URLs allowed' }, { status: 400 })
  }

  try {
    const r = await fetch(u, { redirect: 'follow' })
    if (!r.ok) {
      return NextResponse.json({ error: `upstream ${r.status}` }, { status: r.status })
    }

    const ct = r.headers.get('content-type') ?? 'application/octet-stream'
    const buf = Buffer.from(await r.arrayBuffer())

    // 파일명 sanitize — 한글/공백 허용하되 슬래시/제어문자 제거
    const safeName = name.replace(/[\/\\:\*\?"<>\|]/g, '_').replace(/[\x00-\x1F\x7F]/g, '').slice(0, 200) || 'download'

    const headers = new Headers()
    headers.set('Content-Type', ct)
    // RFC 5987 — 한글 파일명 안전하게 전달
    headers.set('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`)
    headers.set('Content-Length', String(buf.length))
    headers.set('Cache-Control', 'private, max-age=60')

    return new NextResponse(buf, { status: 200, headers })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[download] proxy 실패', msg)
    return NextResponse.json({ error: 'proxy 실패: ' + msg }, { status: 500 })
  }
}
