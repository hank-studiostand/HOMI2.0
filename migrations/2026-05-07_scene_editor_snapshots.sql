-- 씬 경계 편집 — 자동 저장된 스냅샷 (버전 롤백용)
-- scene-editor의 로컬 상태를 주기적으로 직렬화해서 보관.
-- scenes_json: scene-editor의 Scene[] 전체 (id, content, sceneNumber, label, rootAssetMarks, visualSetting)

create table if not exists public.scene_editor_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scenes_json jsonb not null,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id) on delete set null,
  note text
);

create index if not exists scene_editor_snapshots_project_time_idx
  on public.scene_editor_snapshots (project_id, created_at desc);

comment on table public.scene_editor_snapshots is
  '씬 경계 편집 자동 저장 스냅샷. 롤백 시 scenes_json을 그대로 클라이언트 상태에 적용.';
