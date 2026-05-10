-- 2026-05-10: prompt_attempts에 metadata jsonb 추가
-- 워크스페이스 vs 스튜디오 출처 구분 (metadata.source = 'workspace' | 'studio')
-- 향후 다른 메타정보(스튜디오 모드, 프리셋 사용 여부 등)도 여기 누적.

alter table public.prompt_attempts
  add column if not exists metadata jsonb not null default '{}';

-- 조회 가속용 (source 필터)
create index if not exists prompt_attempts_metadata_source_idx
  on public.prompt_attempts ((metadata->>'source'));

-- 백필 — 기존 row는 'workspace'로 가정 (스튜디오는 5/10 이후 신규 도입)
update public.prompt_attempts
   set metadata = jsonb_set(metadata, '{source}', '"workspace"', true)
 where (metadata ? 'source') is not true;
