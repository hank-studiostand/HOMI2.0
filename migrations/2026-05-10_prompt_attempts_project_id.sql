-- 2026-05-10: prompt_attempts 에 project_id 추가 + RLS 갱신.
-- Studio (대본 비독립) 결과는 scene_id 가 NULL 이라 기존 RLS 가 통과 못 함.
-- project_id 직접 저장으로 멤버 체크 가능하게.

alter table public.prompt_attempts
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

-- 1) 기존 row 백필 — scene_id 로부터 project_id
update public.prompt_attempts pa
   set project_id = s.project_id
  from public.scenes s
 where pa.scene_id = s.id
   and pa.project_id is null;

-- 2) RLS 정책 교체 — project_id 우선, 폴백으로 scene 매핑
drop policy if exists "members can manage attempts" on public.prompt_attempts;

create policy "members can manage attempts" on public.prompt_attempts
  for all
  using (
    public.is_project_member(coalesce(
      project_id,
      (select s.project_id from public.scenes s where s.id = scene_id)
    ))
  )
  with check (
    public.is_project_member(coalesce(
      project_id,
      (select s.project_id from public.scenes s where s.id = scene_id)
    ))
  );

-- 3) attempt_outputs RLS 도 보강 — project_id 우선 체크
drop policy if exists "members can manage outputs" on public.attempt_outputs;

create policy "members can manage outputs" on public.attempt_outputs
  for all
  using (
    exists (
      select 1 from public.prompt_attempts pa
       where pa.id = attempt_id
         and public.is_project_member(coalesce(
              pa.project_id,
              (select s.project_id from public.scenes s where s.id = pa.scene_id)
             ))
    )
  )
  with check (
    exists (
      select 1 from public.prompt_attempts pa
       where pa.id = attempt_id
         and public.is_project_member(coalesce(
              pa.project_id,
              (select s.project_id from public.scenes s where s.id = pa.scene_id)
             ))
    )
  );

-- 4) 인덱스
create index if not exists prompt_attempts_project_id_idx on public.prompt_attempts (project_id);
