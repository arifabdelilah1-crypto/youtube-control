-- Studio: scripts on ideas, render jobs, rendered files in Storage, per-channel video style.

alter table public.ideas
  add column if not exists script text,             -- voice-over text
  add column if not exists search_terms text[],     -- stock footage search terms (English works best)
  add column if not exists video_title text,
  add column if not exists video_description text,
  add column if not exists video_tags text[];

-- Per-channel defaults for renders (voice, captions, aspect...)
alter table public.channels add column if not exists video_style jsonb not null default '{}'::jsonb;

create table if not exists public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid references public.ideas(id) on delete set null,
  channel_id uuid references public.channels(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','dispatched','running','done','failed')),
  params jsonb not null,             -- script, terms, aspect, voice, captions, source, materials...
  output_path text,                  -- object path in the 'renders' bucket
  duration_s numeric,
  error text,
  run_url text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists render_jobs_created on public.render_jobs (created_at desc);
alter table public.render_jobs enable row level security;
create policy app_users_all on public.render_jobs for all to authenticated
  using (public.is_app_user()) with check (public.is_app_user());

-- Private bucket for finished videos and uploaded materials
insert into storage.buckets (id, name, public, file_size_limit)
values ('renders', 'renders', false, 52428800)   -- 50 MB: the Supabase free-plan limit per file
on conflict (id) do nothing;

create policy "app users read renders" on storage.objects for select to authenticated
  using (bucket_id = 'renders' and public.is_app_user());
create policy "app users upload materials" on storage.objects for insert to authenticated
  with check (bucket_id = 'renders' and (storage.foldername(name))[1] = 'materials' and public.is_app_user());
create policy "app users delete renders" on storage.objects for delete to authenticated
  using (bucket_id = 'renders' and public.is_app_user());
