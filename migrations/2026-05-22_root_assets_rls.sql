-- 2026-05-22: 루트 에셋 / 씬에디터 스냅샷 — 멤버 공유 RLS 보강
-- Supabase 대시보드 > SQL Editor에서 실행 (idempotent — 반복 실행 안전).
--
-- 증상: '루트 에셋' 페이지에서 + 추가가 동작하지 않음(팀원/owner 모두).
-- 원인: root_asset_seeds 테이블에 멤버 기반 RLS 정책이 없어 insert가 막힘.
--   (정책 없이 RLS만 켜져 있으면 owner를 포함해 모두 차단된다.)
-- 같은 이유로 scene_editor_snapshots(씬 경계 편집 자동 저장)도 정책을 추가한다.

-- ── 0) is_project_member 헬퍼 보장 ────────────────────────────────
create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

-- ── 1) root_asset_seeds — 테이블 보장 + 멤버 RLS ──────────────────
create table if not exists public.root_asset_seeds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null default 'misc',
  name text not null default '',
  description text not null default '',
  reference_image_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists root_asset_seeds_project_idx
  on public.root_asset_seeds (project_id, created_at desc);

alter table public.root_asset_seeds enable row level security;
drop policy if exists "members can manage root asset seeds" on public.root_asset_seeds;
create policy "members can manage root asset seeds" on public.root_asset_seeds
  for all
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── 2) scene_editor_snapshots — 멤버 RLS ──────────────────────────
alter table public.scene_editor_snapshots enable row level security;
drop policy if exists "members can manage scene snapshots" on public.scene_editor_snapshots;
create policy "members can manage scene snapshots" on public.scene_editor_snapshots
  for all
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── 3) Realtime publication (이미 등록됐으면 무시) ────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.root_asset_seeds;
  exception when duplicate_object then null;
  end;
end $$;
