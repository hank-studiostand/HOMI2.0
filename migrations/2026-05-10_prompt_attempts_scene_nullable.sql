-- 2026-05-10: Image Studio / Video Studio 가 대본·씬 비독립으로 동작하도록
-- prompt_attempts.scene_id 를 nullable 로 변경.
-- (워크스페이스 결과는 여전히 scene_id 가 채워지지만, 스튜디오는 null 가능)

alter table public.prompt_attempts
  alter column scene_id drop not null;

-- 옵션: source = 'studio' 인 row 의 scene_id 가 있으면 비워서 명시적으로 분리
-- (이미 워크스페이스 라이브러리/스튜디오 라이브러리가 metadata.source 로 분기하므로 필수는 아님)
-- update public.prompt_attempts
--    set scene_id = null
--  where metadata->>'source' = 'studio';
