-- 2026-04-27: 협업 기능 — 씬 배정 + 프로젝트 채팅
-- Supabase 대시보드 SQL Editor에서 실행

-- ─── 1) 씬 담당자 (assigned_to) ───────────────────────────────
alter table public.scenes
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

create index if not exists scenes_assigned_to_idx
  on public.scenes (assigned_to)
  where assigned_to is not null;

-- ─── 2) 프로젝트 채팅 메시지 ──────────────────────────────────
create table if not exists public.project_messages (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id   uuid references auth.users(id) on delete cascade not null,
  content   text not null,
  -- 멘션된 씬 id 배열 (UI에서 #1-1-1 → 씬 id로 해석한 결과)
  scene_mentions uuid[] not null default '{}',
  created_at timestamptz default now()
);

create index if not exists project_messages_project_created_idx
  on public.project_messages (project_id, created_at desc);

alter table public.project_messages enable row level security;

-- 멤버는 메시지 조회·작성 가능
drop policy if exists "members can read messages"  on public.project_messages;
drop policy if exists "members can write messages" on public.project_messages;

create policy "members can read messages"
  on public.project_messages
  for select
  using (public.is_project_member(project_id));

create policy "members can write messages"
  on public.project_messages
  for insert
  with check (public.is_project_member(project_id) and user_id = auth.uid());

-- 본인 메시지만 삭제 가능 (편집은 일단 미지원)
drop policy if exists "self can delete messages" on public.project_messages;
create policy "self can delete messages"
  on public.project_messages
  for delete
  using (user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table public.project_messages;

-- 씬 변경(assigned_to 포함)도 이미 publication에 등록돼 있음 — no-op
