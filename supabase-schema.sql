-- =============================================
-- AI 영상 협업툴 - Supabase Schema
-- =============================================
-- Supabase 대시보드 > SQL Editor에 붙여넣기하여 실행

-- Extensions
create extension if not exists "uuid-ossp";

-- ── Projects ─────────────────────────────────
create table public.projects (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  owner_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Project Members ───────────────────────────
create table public.project_members (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null default 'editor' check (role in ('owner','editor','viewer')),
  created_at timestamptz default now(),
  unique(project_id, user_id)
);

-- ── Scripts ──────────────────────────────────
create table public.scripts (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  content text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Scenes ───────────────────────────────────
create table public.scenes (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  script_id uuid references public.scripts(id) on delete cascade not null,
  scene_number text not null,      -- e.g. "1", "1-1", "2-3"
  title text not null default '',
  content text not null default '',
  order_index integer not null default 0,
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Scene Settings ────────────────────────────
create table public.scene_settings (
  id uuid primary key default uuid_generate_v4(),
  scene_id uuid references public.scenes(id) on delete cascade not null unique,
  engine text not null default 'nanobanana',
  angle text not null default 'eye-level',
  lens text not null default 'standard',
  object_count integer not null default 1,
  object_positions jsonb not null default '[]',
  mood text not null default '',
  lighting text not null default '',
  notes text not null default '',
  updated_at timestamptz default now()
);

-- ── Master Prompts ────────────────────────────
create table public.master_prompts (
  id uuid primary key default uuid_generate_v4(),
  scene_id uuid references public.scenes(id) on delete cascade not null,
  content text not null,
  negative_prompt text not null default '',
  version integer not null default 1,
  created_at timestamptz default now()
);

-- ── Assets (unified library) ──────────────────
create table public.assets (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  scene_id uuid references public.scenes(id) on delete set null,
  type text not null check (type in ('reference','t2i','i2v','lipsync')),
  name text not null default '',
  url text not null,
  thumbnail_url text,
  satisfaction_score integer check (satisfaction_score between 1 and 5),
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  archived boolean not null default false,
  attempt_id uuid,               -- FK 추후 연결
  created_at timestamptz default now()
);

-- ── Prompt Attempts (tree structure) ──────────
create table public.prompt_attempts (
  id uuid primary key default uuid_generate_v4(),
  scene_id uuid references public.scenes(id) on delete cascade not null,
  parent_id uuid references public.prompt_attempts(id) on delete set null,
  type text not null check (type in ('t2i','i2v','lipsync')),
  prompt text not null,
  negative_prompt text not null default '',
  engine text not null,
  status text not null default 'pending' check (status in ('pending','generating','done','failed')),
  depth integer not null default 0,
  created_at timestamptz default now()
);

-- FK from assets to attempts
alter table public.assets
  add constraint assets_attempt_id_fkey
  foreign key (attempt_id) references public.prompt_attempts(id) on delete set null;

-- ── Project Messages (chat) ───────────────────
create table public.project_messages (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id   uuid references auth.users(id) on delete cascade not null,
  content   text not null,
  scene_mentions uuid[] not null default '{}',
  created_at timestamptz default now()
);

-- ── Attempt Outputs ───────────────────────────
create table public.attempt_outputs (
  id uuid primary key default uuid_generate_v4(),
  attempt_id uuid references public.prompt_attempts(id) on delete cascade not null,
  asset_id uuid references public.assets(id) on delete cascade not null,
  satisfaction_score integer check (satisfaction_score between 1 and 5),
  feedback text not null default '',
  archived boolean not null default false,
  created_at timestamptz default now()
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.scripts enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_settings enable row level security;
alter table public.master_prompts enable row level security;
alter table public.assets enable row level security;
alter table public.prompt_attempts enable row level security;
alter table public.attempt_outputs enable row level security;
alter table public.project_messages enable row level security;

-- Helper: 프로젝트 멤버인지 확인
create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

-- Projects RLS
create policy "members can view projects" on public.projects
  for select using (public.is_project_member(id));
create policy "owner can update project" on public.projects
  for update using (owner_id = auth.uid());
create policy "authenticated can create project" on public.projects
  for insert with check (auth.uid() = owner_id);

-- Project Members RLS
create policy "members can view members" on public.project_members
  for select using (public.is_project_member(project_id));
create policy "owner can manage members" on public.project_members
  for all using (
    exists (select 1 from public.projects where id = project_id and owner_id = auth.uid())
  );

-- Scripts RLS
create policy "members can manage scripts" on public.scripts
  for all using (public.is_project_member(project_id));

-- Scenes RLS
create policy "members can manage scenes" on public.scenes
  for all using (public.is_project_member(project_id));

-- Scene Settings RLS
create policy "members can manage scene settings" on public.scene_settings
  for all using (
    exists (select 1 from public.scenes where id = scene_id and public.is_project_member(project_id))
  );

-- Master Prompts RLS
create policy "members can manage master prompts" on public.master_prompts
  for all using (
    exists (select 1 from public.scenes where id = scene_id and public.is_project_member(project_id))
  );

-- Assets RLS
create policy "members can manage assets" on public.assets
  for all using (public.is_project_member(project_id));

-- Prompt Attempts RLS
create policy "members can manage attempts" on public.prompt_attempts
  for all using (
    exists (select 1 from public.scenes where id = scene_id and public.is_project_member(project_id))
  );

-- Attempt Outputs RLS
create policy "members can manage outputs" on public.attempt_outputs
  for all using (
    exists (
      select 1 from public.prompt_attempts pa
      join public.scenes s on pa.scene_id = s.id
      where pa.id = attempt_id and public.is_project_member(s.project_id)
    )
  );

-- =============================================
-- STORAGE BUCKETS
-- =============================================
-- Supabase 대시보드 > Storage에서 생성:
-- bucket name: "assets"  (public: true)
-- bucket name: "thumbnails" (public: true)

-- =============================================
-- REALTIME
-- =============================================
-- 아래 테이블 Realtime 활성화:
-- scenes, scene_settings, master_prompts, assets, prompt_attempts, attempt_outputs

alter publication supabase_realtime add table public.scenes;
alter publication supabase_realtime add table public.scene_settings;
alter publication supabase_realtime add table public.master_prompts;
alter publication supabase_realtime add table public.assets;
alter publication supabase_realtime add table public.prompt_attempts;
alter publication supabase_realtime add table public.attempt_outputs;
alter publication supabase_realtime add table public.project_messages;
