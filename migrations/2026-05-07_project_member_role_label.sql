-- 멤버 역할에 대한 사용자 정의 라벨 (R&R 이름)
-- 기존 role 컬럼은 권한 체크용으로 'owner'/'editor'/'viewer' 유지
-- role_label은 표시/팀 운영 용도 (예: "기획", "감독", "편집", "QA")

alter table public.project_members
  add column if not exists role_label text;

comment on column public.project_members.role_label is
  'R&R 표시용 사용자 정의 라벨. 권한은 role 컬럼으로 체크. 비어있으면 role을 그대로 표시.';
