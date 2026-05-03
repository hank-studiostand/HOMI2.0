-- 2026-05-03: Shot Workspace + Review + Version Timeline 워크플로
-- Supabase 대시보드 SQL Editor에서 실행

-- ─── 1) Prompt Versions (씬별 프롬프트 버전 추적) ─────────────────
-- 기존 master_prompts와 별개로, 작업 중 시도한 프롬프트 버전을 모두 기록.
create table if not exists public.prompt_versions (
  id uuid primary key default uuid_generate_v4(),
  scene_id uuid references public.scenes(id) on delete cascade not null,
  version_label text not null,                  -- 'V1', 'V2'...
  content text not null,                        -- 프롬프트 본문
  negative_prompt text not null default '',
  is_current boolean not null default false,    -- 현재 활성 버전
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists prompt_versions_scene_idx
  on public.prompt_versions (scene_id, created_at desc);

alter table public.prompt_versions enable row level security;

drop policy if exists "members can manage prompt versions" on public.prompt_versions;
create policy "members can manage prompt versions"
  on public.prompt_versions
  for all using (
    exists (select 1 from public.scenes
            where id = scene_id and public.is_project_member(project_id))
  );

alter publication supabase_realtime add table public.prompt_versions;

-- ─── 2) Shot Decisions (결정 워크플로 — Approve/Revise/Remove) ─────
-- attempt_output에 대해 어떤 결정이 내려졌는지 + 이유 태그 추적.
create table if not exists public.shot_decisions (
  id uuid primary key default uuid_generate_v4(),
  output_id uuid references public.attempt_outputs(id) on delete cascade not null,
  scene_id uuid references public.scenes(id) on delete cascade not null,
  decision_type text not null check (decision_type in ('approved','revise_requested','removed')),
  reason_tags text[] not null default '{}',     -- ['색감 어두움', '카메라 각도'] 등
  comment text not null default '',
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists shot_decisions_output_idx
  on public.shot_decisions (output_id, created_at desc);
create index if not exists shot_decisions_scene_idx
  on public.shot_decisions (scene_id, decision_type);

alter table public.shot_decisions enable row level security;

drop policy if exists "members can manage shot decisions" on public.shot_decisions;
create policy "members can manage shot decisions"
  on public.shot_decisions
  for all using (
    exists (select 1 from public.scenes
            where id = scene_id and public.is_project_member(project_id))
  );

alter publication supabase_realtime add table public.shot_decisions;

-- ─── 3) Shot Comments (워크스페이스 우측 패널 — 결과별 댓글) ────────
-- project_messages는 프로젝트 전체 채팅용. 여기는 결과 단위 스레드.
create table if not exists public.shot_comments (
  id uuid primary key default uuid_generate_v4(),
  scene_id uuid references public.scenes(id) on delete cascade not null,
  output_id uuid references public.attempt_outputs(id) on delete set null,   -- 특정 결과 대상 (옵션)
  prompt_version_id uuid references public.prompt_versions(id) on delete set null,  -- 특정 프롬프트 버전 대상 (옵션)
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

create index if not exists shot_comments_scene_idx
  on public.shot_comments (scene_id, created_at desc);

alter table public.shot_comments enable row level security;

drop policy if exists "members can read shot comments"  on public.shot_comments;
drop policy if exists "members can write shot comments" on public.shot_comments;
drop policy if exists "self can delete shot comments"   on public.shot_comments;

create policy "members can read shot comments"
  on public.shot_comments
  for select using (
    exists (select 1 from public.scenes
            where id = scene_id and public.is_project_member(project_id))
  );

create policy "members can write shot comments"
  on public.shot_comments
  for insert with check (
    exists (select 1 from public.scenes
            where id = scene_id and public.is_project_member(project_id))
    and user_id = auth.uid()
  );

create policy "self can delete shot comments"
  on public.shot_comments
  for delete using (user_id = auth.uid());

alter publication supabase_realtime add table public.shot_comments;

-- ─── 4) Reason Tags 기본값 (선택 옵션) ───────────────────────────
-- 클라이언트에서 하드코딩으로 보여줄 수도 있지만, 프로젝트별로 커스터마이즈하려면
-- 별도 테이블이 필요. 일단 텍스트 배열로 처리하고, 나중에 프로젝트별 셋팅으로 확장.

-- 기존 스키마 파일에도 동기화 필요 — supabase-schema.sql에 위 테이블 추가.
