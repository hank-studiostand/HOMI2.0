-- 2026-05-22: 에셋 공유 보강 — assets RLS 재확인 + Storage 버킷 멤버 정책
-- Supabase 대시보드 > SQL Editor에서 실행 (idempotent — 반복 실행 안전).
--
-- 배경: 프로젝트 팀원이 에셋 라이브러리를 공유받지 못하는 문제.
--   1차 원인은 초대된 팀원이 project_members에 합류하지 않던 것(코드로 수정).
--   이 마이그레이션은 만약을 위해 데이터/스토리지 계층의 공유 정책을 재확인한다.

-- ── 0) is_project_member 헬퍼 재확인 ──────────────────────────────
create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

-- ── 1) assets 테이블 RLS — 멤버면 전부 가능 ────────────────────────
alter table public.assets enable row level security;
drop policy if exists "members can manage assets" on public.assets;
create policy "members can manage assets" on public.assets
  for all
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── 2) Storage 버킷 'assets' — 멤버 읽기/쓰기 ──────────────────────
-- 업로드 경로 규약: '<project_id>/<파일명>' (첫 폴더 = project_id)
-- read 는 버킷이 public:true 라 누구나 가능하지만, 명시적으로도 둔다.
-- write(insert/update/delete) 는 해당 프로젝트 멤버만.
-- 경로 첫 세그먼트를 text 로 비교 — uuid 캐스팅 에러 방지.

drop policy if exists "assets bucket read"   on storage.objects;
drop policy if exists "assets bucket insert" on storage.objects;
drop policy if exists "assets bucket update" on storage.objects;
drop policy if exists "assets bucket delete" on storage.objects;

create policy "assets bucket read" on storage.objects
  for select
  using (bucket_id = 'assets');

create policy "assets bucket insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'assets'
    and exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id::text = split_part(name, '/', 1)
    )
  );

create policy "assets bucket update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'assets'
    and exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id::text = split_part(name, '/', 1)
    )
  );

create policy "assets bucket delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'assets'
    and exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id::text = split_part(name, '/', 1)
    )
  );

-- ── 3) (참고) 기존에 잘못 합류 안 된 팀원 일괄 정리 ────────────────
-- 이미 가입한 사용자에게 발송된 미수락 초대를 멤버로 합류시킨다.
-- auth.users 와 project_invitations(email) 매칭. 안전하게 반복 실행 가능.
insert into public.project_members (project_id, user_id, role)
select pi.project_id, u.id,
       case when pi.role = 'viewer' then 'viewer' else 'editor' end
  from public.project_invitations pi
  join auth.users u on lower(u.email) = lower(pi.email)
 where not exists (
   select 1 from public.project_members pm
    where pm.project_id = pi.project_id and pm.user_id = u.id
 )
on conflict (project_id, user_id) do nothing;

update public.project_invitations pi
   set accepted_at = now()
  from auth.users u
 where lower(u.email) = lower(pi.email)
   and pi.accepted_at is null;
