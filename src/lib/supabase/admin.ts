import { createClient } from '@supabase/supabase-js'

// RLS 우회용 서비스롤 클라이언트 (서버 사이드 전용)
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
