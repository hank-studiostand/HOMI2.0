// Production-disabled — 진단 시에만 임시로 코드 켜기
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ disabled: true }, { status: 404 })
}
