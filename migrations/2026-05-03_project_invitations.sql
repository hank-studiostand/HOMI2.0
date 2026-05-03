-- 팀 초대 — 미가입자 이메일 초대 지원
-- (Supabase auth.admin.inviteUserByEmail 와 함께 사용)

create table if not exists public.project_invitations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  email       text not null,
  role        text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by  uuid not null references auth.users(id) on delete cascade,
  token       text not null default encode(gen_random_bytes(24), 'hex'),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (project_id, email)
);

create index if not exists project_invitations_project_idx
  on public.project_invitations (project_id);
create index if not exists project_invitations_email_idx
  on public.project_invitations (email);

alter table public.project_invitations enable row level security;

-- 본인이 초대 요청한 행 조회 / 본인이 owner인 프로젝트 행 조회 가능
create policy "members_can_read_own_invitations" on public.project_invitations
  for select using (
    auth.uid() = invited_by
    or project_id in (select id from public.projects where owner_id = auth.uid())
  );

-- 프로젝트 owner만 초대 추가
create policy "owner_can_insert_invitations" on public.project_invitations
  for insert with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

-- owner만 초대 취소(delete)
create policy "owner_can_delete_invitations" on public.project_invitations
  for delete using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );
