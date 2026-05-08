import { NextRequest, NextResponse } from 'next/server'

// /api/download?url=<encoded>&name=<filename>
// 외부 이미지/영상 URL을 서버에서 fetch해서 Content-Disposition: attachment 으로 다시 내려줌.
// CORS 우회용 — 클라이언트 <a download href="/api/download?...">로 강제 다운로드.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('url')
  const name = req.nextUrl.searchParams.get('name') ?? 'download'

  if (!u) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  if (!/^https?:\/\//i.test(u)) {
    return NextResponse.json({ error: 'only http/https URLs allowed' }, { status: 400 })
  }

  console.log('[download] proxy 요청:', { url: u.slice(0, 200), name })

  try {
    const upstream = await fetch(u, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    })
    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '')
      console.error('[download] upstream 실패', upstream.status, errBody.slice(0, 300))
      const msg = '원본 서버 응답 ' + upstream.status + ': ' + (errBody.slice(0, 300) || upstream.statusText)
      return NextResponse.json({ error: msg }, { status: upstream.status })
    }

    const safeName = (name
      .replace(/[\/\\:\*\?"<>\|]/g, '_')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .slice(0, 200)) || 'download'

    const ct = upstream.headers.get('content-type') ?? 'application/octet-stream'
    const cl = upstream.headers.get('content-length')

    const dispNameAscii = safeName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
    const dispNameUtf8  = encodeURIComponent(safeName)

    const headers = new Headers()
    headers.set('Content-Type', ct)
    headers.set(
      'Content-Disposition',
      'attachment; filename="' + dispNameAscii + '"; filename*=UTF-8\'\'' + dispNameUtf8,
    )
    if (cl) headers.set('Content-Length', cl)
    headers.set('Cache-Control', 'private, no-store')

    // 스트림으로 통과 (Vercel Hobby 4.5MB 메모리 한도 회피)
    return new NextResponse(upstream.body, { status: 200, headers })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[download] proxy 실패', msg)
    return NextResponse.json({ error: 'proxy 실패: ' + msg }, { status: 500 })
  }
}
