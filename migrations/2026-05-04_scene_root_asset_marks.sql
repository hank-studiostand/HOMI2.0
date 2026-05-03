-- 씬에 인물/공간/오브제/기타 텍스트 마킹 (자동 추출용)
-- 이미 만들어져 있을 수 있음 → IF NOT EXISTS 가드

alter table public.scenes
  add column if not exists root_asset_marks jsonb default '{}'::jsonb;

alter table public.scenes
  add column if not exists selected_root_asset_image_ids jsonb default '{}'::jsonb;

alter table public.scenes
  add column if not exists selected_root_asset_ids jsonb default '{}'::jsonb;

create index if not exists scenes_root_asset_marks_idx
  on public.scenes using gin (root_asset_marks);
