-- Video editor: projects split into scenes (voice + clip + caption per scene), music library.
-- owner_id is filled from day one so per-user accounts can be switched on later without a data migration.
-- Access stays "allow-listed users share everything" for now.

create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  idea_id uuid references public.ideas(id) on delete set null,
  channel_id uuid references public.channels(id) on delete set null,
  title text not null default 'Untitled video',
  language text not null default 'en',
  voice text not null default 'en-US-AndrewNeural-Male',
  voice_rate numeric not null default 1.1,
  aspect text not null default '9:16' check (aspect in ('9:16', '16:9', '1:1')),
  settings jsonb not null default '{}'::jsonb,   -- captions, hook, progress bar, sfx, music
  status text not null default 'draft' check (status in ('draft', 'preparing', 'ready', 'failed')),
  error text,
  run_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists video_projects_idea on public.video_projects (idea_id);
create index if not exists video_projects_updated on public.video_projects (updated_at desc);

create table if not exists public.project_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  idx int not null,
  text text not null,
  terms text[] not null default '{}',
  voice_path text,              -- object path in the 'renders' bucket
  voice_text text,              -- text the current voice was made from (differs from text -> voice outdated)
  voice_duration numeric,       -- seconds
  words jsonb,                  -- [{w, s, e}] seconds from scene start
  clip jsonb,                   -- {type: video|image|card, url, preview, thumb, duration, width, height, trim, source, id}
  candidates jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists project_scenes_project on public.project_scenes (project_id, idx);

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  mood text not null,
  title text not null,
  path text not null,           -- object path in the 'renders' bucket (music/...)
  duration numeric,
  created_at timestamptz not null default now()
);
create index if not exists music_tracks_mood on public.music_tracks (mood);

alter table public.render_jobs add column if not exists project_id uuid references public.video_projects(id) on delete set null;

drop trigger if exists video_projects_touch on public.video_projects;
create trigger video_projects_touch before update on public.video_projects for each row execute function public.touch_updated_at();
drop trigger if exists project_scenes_touch on public.project_scenes;
create trigger project_scenes_touch before update on public.project_scenes for each row execute function public.touch_updated_at();

alter table public.video_projects enable row level security;
alter table public.project_scenes enable row level security;
alter table public.music_tracks enable row level security;
create policy app_users_all on public.video_projects for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy app_users_all on public.project_scenes for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy app_users_all on public.music_tracks for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

-- Uploads from the dashboard: own clips/images for scenes, and music tracks.
create policy "app users upload project media and music" on storage.objects for insert to authenticated
  with check (bucket_id = 'renders' and (storage.foldername(name))[1] in ('projects', 'music') and public.is_app_user());
