-- 씬별 캐릭터 변동사항 (의상/헤어/표정 등) 텍스트 노트
-- 구조: { "<root_asset_seed_id>": "검정 코트, 면도 안한 상태" }
-- 워크스페이스 루트 프롬프트 합치기에서 [인물: name] 블록 뒤에 부착됨

alter table public.scenes
  add column if not exists character_variations jsonb default '{}'::jsonb;

create index if not exists scenes_character_variations_idx
  on public.scenes using gin (character_variations);

comment on column public.scenes.character_variations is
  '캐릭터 변동사항 노트. key=root_asset_seed_id, value=텍스트 (의상/상태/헤어 등). 워크스페이스 프롬프트 머지에 자동 사용.';
