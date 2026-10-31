-- Outlier -> blueprint -> script pipeline (DeepSeek, edge function "ai").
alter table public.ideas
  add column if not exists source_video jsonb,   -- snapshot of the outlier: title, description, tags, stats, top comments, keyword
  add column if not exists transcript text,      -- optional, pasted by the user
  add column if not exists blueprint jsonb,      -- format analysis: hook, beats, pacing, tone, CTA, why it worked
  add column if not exists ai jsonb,             -- last generation: title options, hook text, music mood, facts to verify, notes
  add column if not exists ai_status text check (ai_status in ('capturing', 'analyzing', 'writing', 'ready', 'failed')),
  add column if not exists ai_error text;

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  idea_id uuid references public.ideas(id) on delete set null,
  kind text not null,                 -- blueprint | script
  model text not null,
  prompt_tokens int,
  completion_tokens int,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_runs_created on public.ai_runs (created_at desc);
alter table public.ai_runs enable row level security;
create policy app_users_all on public.ai_runs for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
