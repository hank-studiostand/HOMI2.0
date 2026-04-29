-- 2026-04-29: attempt_outputs에 만족도 피드백 텍스트 컬럼 추가
-- T2I/I2V 별점 매길 때 짧은 코멘트 입력란용 (MVP)

alter table public.attempt_outputs
  add column if not exists feedback text not null default '';
