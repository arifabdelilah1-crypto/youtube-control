-- The AI safety cap: how many AI calls (ai_runs) may run in 24 h, all functions together. It was a fixed 200 in each
-- function; it's now a setting (Settings → AI safety cap) read by every function and by the "Generate video" job,
-- which waits for room instead of failing when the cap is reached.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_users_all on public.app_settings;
create policy app_users_all on public.app_settings for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings for each row execute function public.touch_updated_at();

insert into public.app_settings (key, value) values ('ai_daily_runs', '400') on conflict (key) do nothing;

create index if not exists ai_runs_created_at on public.ai_runs (created_at);

-- {used, cap}: the AI calls of the last 24 h and the cap. Runs with the caller's rights: the dashboard (app users,
-- through RLS) and the server functions and jobs (service role) can both read ai_runs and app_settings.
create or replace function public.ai_runs_status()
returns table (used bigint, cap integer)
language sql stable security invoker set search_path = public as $$
  select (select count(*) from public.ai_runs where created_at >= now() - interval '24 hours'),
         coalesce((select greatest(1, round((value #>> '{}')::numeric))::int from public.app_settings
                   where key = 'ai_daily_runs' and jsonb_typeof(value) = 'number'), 400)
$$;
revoke all on function public.ai_runs_status() from public, anon;
grant execute on function public.ai_runs_status() to authenticated, service_role;
