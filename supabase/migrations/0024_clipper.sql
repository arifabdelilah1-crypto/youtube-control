-- Long video -> Shorts. A long video (clip_sources) is transcribed and cut into scenes by the "Long to Shorts" GitHub job;
-- DeepSeek proposes 1-3 Shorts (clips), each a list of scenes you review before rendering.
-- Files live on the VDS: the original and a small preview as videos/<uuid>.mp4, scene frames as thumbs/<source id>-<8 hex>.jpg.
-- A rendered Short becomes an idea + a finished render_jobs row, so it shows on the Review page and publishes like any video.

create table if not exists public.clip_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  title text not null default 'Long video',
  source_url text,                      -- the link it came from (null when uploaded)
  file_path text,                       -- vds:videos/<id>.mp4, the original
  proxy_path text,                      -- vds:videos/<uuid>.mp4, 360p for previews
  duration_s numeric, width int, height int,
  language text,                        -- detected or picked
  settings jsonb not null default '{}', -- {count, min_s, max_s, language, channel_id}
  status text not null default 'queued' check (status in ('uploading', 'queued', 'downloading', 'transcribing', 'finding', 'ready', 'failed')),
  progress int not null default 0,
  step text,
  error text,
  run_url text,
  words jsonb,                          -- [[start, end, "word"], ...]
  scene_cuts jsonb,                     -- [seconds, ...]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  source_id uuid not null references public.clip_sources(id) on delete cascade,
  idx int not null default 0,
  score int, reason text, hook text,
  title text, description text, tags text[] not null default '{}',
  scenes jsonb not null default '[]',      -- [{start, end, crop: face|center|left|right|fit, thumb}]
  ai_scenes jsonb not null default '[]',   -- the scenes as first proposed, for "Reset"
  channel_id uuid references public.channels(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'rendering', 'done', 'failed', 'discarded')),
  output_path text, thumb_path text, duration_s numeric,
  idea_id uuid references public.ideas(id) on delete set null,
  render_job_id uuid references public.render_jobs(id) on delete set null,
  error text, run_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clips_source on public.clips (source_id, idx);

drop trigger if exists clip_sources_touch on public.clip_sources;
create trigger clip_sources_touch before update on public.clip_sources for each row execute function public.touch_updated_at();
drop trigger if exists clips_touch on public.clips;
create trigger clips_touch before update on public.clips for each row execute function public.touch_updated_at();

alter table public.clip_sources enable row level security;
alter table public.clips enable row level security;
drop policy if exists app_users_all on public.clip_sources;
drop policy if exists app_users_all on public.clips;
create policy app_users_all on public.clip_sources for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy app_users_all on public.clips for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
