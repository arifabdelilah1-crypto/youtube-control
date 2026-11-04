-- One press of "Generate video": an idea going by itself through script, voice, clips, music, render and checks (render/autovideo.mjs).
create table if not exists public.video_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  project_id uuid references public.video_projects(id) on delete set null,
  render_job_id uuid references public.render_jobs(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'review', 'failed', 'cancelled')),
  options jsonb not null default '{}'::jsonb,   -- what was chosen before generating
  steps jsonb not null default '[]'::jsonb,     -- [{key, status, detail}]
  warnings jsonb not null default '[]'::jsonb,  -- what the creator should look at
  checks jsonb not null default '[]'::jsonb,    -- final checks: [{name, ok, detail}]
  error text,
  run_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists video_runs_idea on public.video_runs (idea_id, created_at desc);
drop trigger if exists video_runs_touch on public.video_runs;
create trigger video_runs_touch before update on public.video_runs for each row execute function public.touch_updated_at();
alter table public.video_runs enable row level security;
drop policy if exists app_users_all on public.video_runs;
create policy app_users_all on public.video_runs for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
