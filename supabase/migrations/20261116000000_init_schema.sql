-- Gharzetak — initial schema.
-- Migrations are the single source of truth. Every user-data table has RLS enabled
-- with ownership predicates on SELECT / INSERT / UPDATE (USING + WITH CHECK) / DELETE.

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------
-- helpers
-- ------------------------------------------------------------------
create or replace function public.gz_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.updated_at is null then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Last-write-wins guard for offline sync: an upsert carrying an OLDER client timestamp
-- than the stored row is ignored, so a stale device can never overwrite newer progress.
create or replace function public.gz_lww_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.updated_at is not null and old.updated_at is not null and new.updated_at < old.updated_at then
    return null; -- skip this update, keep the newer row
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------
-- profiles & preferences
-- ------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  level text not null default 'beginner' check (level in ('beginner', 'intermediate', 'advanced')),
  terms text not null default 'us' check (terms in ('us', 'uk')),
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  interests text[] not null default '{}',
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_tools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('hook', 'yarn', 'accessory')),
  value text not null check (char_length(value) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);
create index user_tools_user_idx on public.user_tools (user_id);

-- create a profile row automatically for every new auth user
create or replace function public.gz_handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 80), ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.gz_handle_new_user();

-- ------------------------------------------------------------------
-- patterns (reusable definitions) — separate from user progress
-- ------------------------------------------------------------------
create table public.patterns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,      -- null = built-in sample
  is_sample boolean not null default false,
  name text not null check (char_length(name) between 1 and 120),
  name_ar text,
  name_en text,
  level text not null default 'beginner' check (level in ('beginner', 'intermediate', 'advanced')),
  terms text not null default 'us' check (terms in ('us', 'uk')),
  source_type text not null default 'text' check (source_type in ('sample', 'text', 'pdf', 'image', 'youtube')),
  source_url text check (source_url is null or char_length(source_url) <= 500),
  attribution text check (attribution is null or char_length(attribution) <= 200),
  raw_text text not null default '' check (char_length(raw_text) <= 20000),
  file_path text,
  file_name text,
  file_size integer check (file_size is null or file_size between 0 and 10485760),
  file_mime text,
  reading_position integer not null default 0 check (reading_position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint patterns_owner_or_sample check ((is_sample and owner_id is null) or (not is_sample and owner_id is not null))
);
create index patterns_owner_idx on public.patterns (owner_id);

create table public.pattern_rounds (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references public.patterns (id) on delete cascade,
  position integer not null check (position >= 0),
  round_number integer not null,
  raw text not null,
  parsed_ok boolean not null,
  consumed integer not null default 0,
  produced integer not null default 0,
  declared_total integer,
  unique (pattern_id, position)
);
create index pattern_rounds_pattern_idx on public.pattern_rounds (pattern_id);

-- ------------------------------------------------------------------
-- projects & per-user progress
-- ------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category text not null default 'amigurumi' check (category in ('amigurumi', 'clothes', 'accessories', 'home', 'gifts')),
  hook_size text not null default '3.0' check (char_length(hook_size) <= 10),
  yarn_type text not null default 'cotton' check (yarn_type in ('cotton', 'acrylic', 'wool', 'velvet', 'blend', 'milk')),
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  pattern_id uuid references public.patterns (id) on delete set null,
  cover_path text,
  estimated_hours numeric(6, 1) not null default 0 check (estimated_hours >= 0),
  worked_seconds integer not null default 0 check (worked_seconds >= 0),
  last_worked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_owner_idx on public.projects (owner_id, updated_at desc);

create table public.project_parts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  pattern_id uuid references public.patterns (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_parts_project_idx on public.project_parts (project_id);

-- tracker state for one project (simple counter + pattern cursor + undo history)
create table public.project_progress (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  mode text not null default 'simple' check (mode in ('simple', 'pattern')),
  round integer not null default 1 check (round >= 1),
  target integer not null default 30 check (target between 1 and 999),
  per_tap integer not null default 1 check (per_tap between 1 and 99),
  count integer not null default 0 check (count >= 0),
  total_rounds integer not null default 0 check (total_rounds >= 0),
  pattern_id uuid references public.patterns (id) on delete set null,
  pattern_round_index integer not null default 0 check (pattern_round_index >= 0),
  action_ptr integer not null default 0 check (action_ptr >= 0),
  count_mode text not null default 'action' check (count_mode in ('action', 'group', 'round')),
  history jsonb not null default '[]'::jsonb,
  pattern_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint project_progress_count_le_target check (count <= target)
);
create index project_progress_owner_idx on public.project_progress (owner_id);

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 10000),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table public.project_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 8388608),
  width integer,
  height integer,
  is_cover boolean not null default false,
  created_at timestamptz not null default now(),
  -- the object must live under <owner>/<project>/
  constraint project_photos_path_owner check (split_part(storage_path, '/', 1) = owner_id::text and split_part(storage_path, '/', 2) = project_id::text)
);
create index project_photos_project_idx on public.project_photos (project_id);

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  seconds integer not null check (seconds between 0 and 86400),
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index work_sessions_project_idx on public.work_sessions (project_id);

-- ------------------------------------------------------------------
-- favourites, tutorial bookmarks & timestamps, store interest
-- ------------------------------------------------------------------
create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_type text not null check (item_type in ('tutorial', 'pattern')),
  item_id text not null check (char_length(item_id) <= 64),
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

create table public.tutorial_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tutorial_id text not null check (char_length(tutorial_id) <= 64),
  youtube_url text check (youtube_url is null or youtube_url ~* '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/'),
  creator_name text check (creator_name is null or char_length(creator_name) <= 120),
  project_id uuid references public.projects (id) on delete set null,
  notes text not null default '' check (char_length(notes) <= 10000),
  updated_at timestamptz not null default now(),
  unique (user_id, tutorial_id)
);

create table public.tutorial_timestamps (
  id uuid primary key default gen_random_uuid(),
  bookmark_id uuid not null references public.tutorial_bookmarks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seconds integer not null check (seconds between 0 and 86400),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index tutorial_timestamps_bookmark_idx on public.tutorial_timestamps (bookmark_id);

create table public.store_interest (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- triggers
-- ------------------------------------------------------------------
create trigger profiles_lww before update on public.profiles for each row execute function public.gz_lww_guard();
create trigger patterns_lww before update on public.patterns for each row execute function public.gz_lww_guard();
create trigger projects_lww before update on public.projects for each row execute function public.gz_lww_guard();
create trigger project_parts_lww before update on public.project_parts for each row execute function public.gz_lww_guard();
create trigger project_progress_lww before update on public.project_progress for each row execute function public.gz_lww_guard();
create trigger project_notes_lww before update on public.project_notes for each row execute function public.gz_lww_guard();
create trigger tutorial_bookmarks_lww before update on public.tutorial_bookmarks for each row execute function public.gz_lww_guard();

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_tools enable row level security;
alter table public.patterns enable row level security;
alter table public.pattern_rounds enable row level security;
alter table public.projects enable row level security;
alter table public.project_parts enable row level security;
alter table public.project_progress enable row level security;
alter table public.project_notes enable row level security;
alter table public.project_photos enable row level security;
alter table public.work_sessions enable row level security;
alter table public.favorites enable row level security;
alter table public.tutorial_bookmarks enable row level security;
alter table public.tutorial_timestamps enable row level security;
alter table public.store_interest enable row level security;

-- profiles: own row only (insert happens via trigger; allow self-insert as a fallback)
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- generic owner policies
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('user_tools', 'user_id'),
      ('projects', 'owner_id'),
      ('project_parts', 'owner_id'),
      ('project_progress', 'owner_id'),
      ('project_notes', 'owner_id'),
      ('project_photos', 'owner_id'),
      ('work_sessions', 'owner_id'),
      ('favorites', 'user_id'),
      ('tutorial_bookmarks', 'user_id'),
      ('tutorial_timestamps', 'user_id'),
      ('store_interest', 'user_id')
    ) as v(tbl, col)
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (%2$I = (select auth.uid()))', t.tbl, t.col);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (%2$I = (select auth.uid()))', t.tbl, t.col);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (%2$I = (select auth.uid())) with check (%2$I = (select auth.uid()))', t.tbl, t.col);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (%2$I = (select auth.uid()))', t.tbl, t.col);
  end loop;
end $$;

-- child rows must reference a parent the user owns
create policy project_children_parent_check on public.project_progress as restrictive for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_notes_parent_check on public.project_notes as restrictive for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_photos_parent_check on public.project_photos as restrictive for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_parts_parent_check on public.project_parts as restrictive for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy work_sessions_parent_check on public.work_sessions as restrictive for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy tutorial_timestamps_parent_check on public.tutorial_timestamps as restrictive for all to authenticated
  using (exists (select 1 from public.tutorial_bookmarks b where b.id = bookmark_id and b.user_id = (select auth.uid())))
  with check (exists (select 1 from public.tutorial_bookmarks b where b.id = bookmark_id and b.user_id = (select auth.uid())));

-- a project may only link a pattern the user can read
create policy projects_pattern_readable on public.projects as restrictive for insert to authenticated
  with check (pattern_id is null or exists (select 1 from public.patterns pt where pt.id = pattern_id and (pt.is_sample or pt.owner_id = (select auth.uid()))));
create policy projects_pattern_readable_upd on public.projects as restrictive for update to authenticated
  using (true)
  with check (pattern_id is null or exists (select 1 from public.patterns pt where pt.id = pattern_id and (pt.is_sample or pt.owner_id = (select auth.uid()))));

-- patterns: samples are readable by everyone (incl. guests); private patterns by their owner only
create policy patterns_select on public.patterns for select to anon, authenticated
  using (is_sample or owner_id = (select auth.uid()));
create policy patterns_insert on public.patterns for insert to authenticated
  with check (owner_id = (select auth.uid()) and not is_sample);
create policy patterns_update on public.patterns for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and not is_sample);
create policy patterns_delete on public.patterns for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy pattern_rounds_select on public.pattern_rounds for select to anon, authenticated
  using (exists (select 1 from public.patterns p where p.id = pattern_id and (p.is_sample or p.owner_id = (select auth.uid()))));
create policy pattern_rounds_write on public.pattern_rounds for all to authenticated
  using (exists (select 1 from public.patterns p where p.id = pattern_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.patterns p where p.id = pattern_id and p.owner_id = (select auth.uid())));

-- explicit grants (RLS still applies)
grant select on public.patterns, public.pattern_rounds to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ------------------------------------------------------------------
-- Storage: private buckets, path = <uid>/<project or pattern id>/<file>
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('project-photos', 'project-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('pattern-files', 'pattern-files', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy gz_storage_select on storage.objects for select to authenticated
  using (bucket_id in ('project-photos', 'pattern-files') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy gz_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('project-photos', 'pattern-files')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
  );
create policy gz_storage_update on storage.objects for update to authenticated
  using (bucket_id in ('project-photos', 'pattern-files') and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('project-photos', 'pattern-files') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy gz_storage_delete on storage.objects for delete to authenticated
  using (bucket_id in ('project-photos', 'pattern-files') and (storage.foldername(name))[1] = (select auth.uid())::text);
