-- YouTube Control — initial schema
-- Multi-channel, niche-agnostic research + channel control.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Access: only allow-listed accounts can use the dashboard
-- ---------------------------------------------------------------
create table public.app_users (
  email text primary key,
  added_at timestamptz not null default now()
);

create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------------------------------------------------------------
-- Niches, seed terms, channels
-- ---------------------------------------------------------------
create table public.niches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  languages text[] not null default '{}',
  markets text[] not null default '{}',          -- ISO country codes, e.g. {US,GB,MA}
  weights jsonb not null default '{"demand":0.40,"momentum":0.35,"competition":0.25}',
  daily_unit_budget int not null default 2500,    -- YouTube Data API units per day
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger niches_touch before update on public.niches
  for each row execute function public.touch_updated_at();

create type public.seed_kind as enum ('entity', 'format', 'topic');

create table public.seed_terms (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references public.niches(id) on delete cascade,
  term text not null,
  kind public.seed_kind not null default 'topic',
  active boolean not null default true,
  last_researched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (niche_id, term)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  youtube_channel_id text unique,
  title text not null,
  handle text,
  thumbnail_url text,
  niche_id uuid references public.niches(id) on delete set null,
  language text,
  markets text[] not null default '{}',
  google_account text,                 -- which Google account / brand account it sits on
  blotato_account_id text,
  connected boolean not null default false,
  ypp_watch_hours_target int not null default 8000,
  ypp_subs_target int not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger channels_touch before update on public.channels
  for each row execute function public.touch_updated_at();

-- OAuth refresh tokens live in Supabase Vault; this table only points at them.
create table public.channel_tokens (
  channel_id uuid primary key references public.channels(id) on delete cascade,
  vault_secret_id uuid not null,
  scopes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Own channel analytics
-- ---------------------------------------------------------------
create table public.channel_snapshots (
  channel_id uuid not null references public.channels(id) on delete cascade,
  captured_at timestamptz not null default now(),
  subscribers bigint,
  total_views bigint,
  video_count int,
  primary key (channel_id, captured_at)
);

create table public.channel_daily_stats (
  channel_id uuid not null references public.channels(id) on delete cascade,
  day date not null,
  views bigint not null default 0,
  watch_minutes numeric not null default 0,
  subs_gained int not null default 0,
  subs_lost int not null default 0,
  avg_view_duration_s numeric,
  shorts_views bigint,
  impressions bigint,
  impressions_ctr numeric,
  primary key (channel_id, day)
);

create table public.own_videos (
  youtube_video_id text primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  title text,
  published_at timestamptz,
  duration_s int,
  is_short boolean,
  thumbnail_url text,
  updated_at timestamptz not null default now()
);

create table public.own_video_daily (
  youtube_video_id text not null references public.own_videos(youtube_video_id) on delete cascade,
  day date not null,
  views bigint not null default 0,
  watch_minutes numeric not null default 0,
  avg_view_pct numeric,
  likes int,
  comments int,
  primary key (youtube_video_id, day)
);

create table public.channel_search_terms (
  channel_id uuid not null references public.channels(id) on delete cascade,
  period_end date not null,
  term text not null,
  views bigint not null default 0,
  primary key (channel_id, period_end, term)
);

-- ---------------------------------------------------------------
-- Market research: keywords, external videos and channels
-- ---------------------------------------------------------------
create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references public.niches(id) on delete cascade,
  market text not null default 'GLOBAL',
  term text not null,
  source text not null default 'seed',          -- seed | autocomplete | trends | channel_search | manual
  first_seen timestamptz not null default now(),
  unique (niche_id, market, term)
);

create table public.keyword_snapshots (
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  captured_on date not null default current_date,
  trends_interest numeric,          -- 0–100, YouTube Search property, latest week
  trends_avg_7d numeric,
  trends_avg_30d numeric,
  yt_autocomplete_rank int,         -- 1 = first suggestion, null = not suggested
  google_autocomplete_rank int,
  recent_uploads int,               -- uploads in last 30 d found for the term
  big_channel_uploads int,          -- of those, from channels > 100k subs
  outlier_count int,                -- videos on the term with outlier score >= 3
  top_views_median bigint,
  primary key (keyword_id, captured_on)
);

create table public.ext_channels (
  youtube_channel_id text primary key,
  title text,
  subscribers bigint,
  hidden_subscribers boolean not null default false,
  video_count int,
  median_recent_views bigint,
  updated_at timestamptz not null default now()
);

create table public.videos (
  youtube_video_id text primary key,
  youtube_channel_id text references public.ext_channels(youtube_channel_id) on delete set null,
  niche_id uuid references public.niches(id) on delete set null,
  title text,
  description text,
  tags text[],
  published_at timestamptz,
  duration_s int,
  is_short boolean,
  thumbnail_url text,
  first_seen timestamptz not null default now()
);
create index videos_niche_published on public.videos (niche_id, published_at desc);

create table public.video_snapshots (
  youtube_video_id text not null references public.videos(youtube_video_id) on delete cascade,
  captured_at timestamptz not null default now(),
  views bigint,
  likes bigint,
  comments bigint,
  primary key (youtube_video_id, captured_at)
);

create table public.video_keywords (
  youtube_video_id text not null references public.videos(youtube_video_id) on delete cascade,
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  primary key (youtube_video_id, keyword_id)
);

create type public.competitor_source as enum ('auto', 'manual');

create table public.competitors (
  niche_id uuid not null references public.niches(id) on delete cascade,
  youtube_channel_id text not null references public.ext_channels(youtube_channel_id) on delete cascade,
  source public.competitor_source not null default 'auto',
  added_at timestamptz not null default now(),
  primary key (niche_id, youtube_channel_id)
);

-- ---------------------------------------------------------------
-- Ideas pipeline
-- ---------------------------------------------------------------
create type public.idea_stage as enum
  ('new', 'shortlisted', 'assigned', 'scripted', 'produced', 'scheduled', 'published', 'archived');

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid references public.niches(id) on delete set null,
  channel_id uuid references public.channels(id) on delete set null,
  title text not null,
  score numeric,
  stage public.idea_stage not null default 'new',
  sources jsonb not null default '[]',          -- [{type:'keyword'|'outlier'|'comment', ref:'…'}]
  notes text,
  blotato_post_id text,
  published_video_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ideas_touch before update on public.ideas
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- Publishing (Blotato mirror)
-- ---------------------------------------------------------------
create table public.blotato_posts (
  id text primary key,
  channel_id uuid references public.channels(id) on delete set null,
  platform text not null,                       -- youtube | tiktok | instagram | facebook | …
  status text not null,                         -- scheduled | published | failed | draft
  title text,
  scheduled_at timestamptz,
  published_at timestamptz,
  post_url text,
  error text,
  updated_at timestamptz not null default now()
);
create index blotato_posts_sched on public.blotato_posts (channel_id, scheduled_at);

-- ---------------------------------------------------------------
-- System: jobs, quota, alerts
-- ---------------------------------------------------------------
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',       -- running | ok | warning | failed
  units_used int not null default 0,
  details jsonb not null default '{}'
);
create index job_runs_job_started on public.job_runs (job, started_at desc);

create table public.api_quota_daily (
  day date not null default current_date,
  api text not null,                            -- youtube_data | youtube_analytics | trends
  bucket text not null,                         -- research | details | lookup | channel_stats
  niche_key text not null default 'all',        -- niche slug, or 'all'
  units int not null default 0,
  primary key (day, api, bucket, niche_key)
);

create table public.alerts (
  id bigint generated always as identity primary key,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  title text not null,
  detail text,
  channel_id uuid references public.channels(id) on delete cascade,
  niche_id uuid references public.niches(id) on delete cascade,
  dedupe_key text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index alerts_open_dedupe on public.alerts (dedupe_key) where resolved_at is null;

-- ---------------------------------------------------------------
-- Scoring views (security_invoker so RLS applies)
-- ---------------------------------------------------------------
create view public.v_video_latest with (security_invoker = true) as
select distinct on (v.youtube_video_id)
  v.youtube_video_id, v.niche_id, v.title, v.published_at, v.is_short, v.thumbnail_url,
  v.youtube_channel_id, c.title as channel_title, c.subscribers, c.median_recent_views,
  s.views, s.likes, s.comments, s.captured_at,
  -- outlier: views vs channel size and vs channel's usual views; the stronger signal wins
  round(greatest(
    s.views::numeric / greatest(coalesce(c.subscribers, 0), 100),
    s.views::numeric / greatest(coalesce(c.median_recent_views, 0), 100)
  ), 2) as outlier_score,
  round(s.views::numeric / greatest(extract(epoch from (s.captured_at - v.published_at)) / 3600, 1), 1) as views_per_hour,
  round((coalesce(s.likes, 0) + coalesce(s.comments, 0))::numeric / greatest(s.views, 1) * 100, 2) as engagement_pct
from public.videos v
join public.video_snapshots s using (youtube_video_id)
left join public.ext_channels c on c.youtube_channel_id = v.youtube_channel_id
order by v.youtube_video_id, s.captured_at desc;

create view public.v_keyword_latest with (security_invoker = true) as
select distinct on (k.id)
  k.id as keyword_id, k.niche_id, k.market, k.term, k.source,
  s.captured_on, s.trends_interest, s.trends_avg_7d, s.trends_avg_30d,
  s.yt_autocomplete_rank, s.google_autocomplete_rank, s.recent_uploads,
  s.big_channel_uploads, s.outlier_count, s.top_views_median
from public.keywords k
join public.keyword_snapshots s on s.keyword_id = k.id
order by k.id, s.captured_on desc;

create view public.v_keyword_scores with (security_invoker = true) as
with raw as (
  select
    l.keyword_id, l.niche_id, l.market, l.term, l.captured_on,
    l.trends_interest, l.yt_autocomplete_rank, l.google_autocomplete_rank,
    l.recent_uploads, l.big_channel_uploads, l.outlier_count,
    ( coalesce(l.trends_interest, 0) / 100.0 * 0.5
    + case when l.yt_autocomplete_rank is null then 0 else greatest(11 - l.yt_autocomplete_rank, 0) / 10.0 end * 0.3
    + least(coalesce(l.outlier_count, 0), 10) / 10.0 * 0.2 ) as demand_raw,
    coalesce(l.trends_avg_7d, 0) / greatest(coalesce(l.trends_avg_30d, 0), 1) as momentum_raw,
    coalesce(l.big_channel_uploads, 0) + coalesce(l.recent_uploads, 0) * 0.1 as competition_raw
  from public.v_keyword_latest l
),
pct as (
  select r.*,
    round((percent_rank() over (partition by niche_id, market order by demand_raw) * 100)::numeric) as demand,
    round((percent_rank() over (partition by niche_id, market order by momentum_raw) * 100)::numeric) as momentum,
    round((percent_rank() over (partition by niche_id, market order by competition_raw) * 100)::numeric) as competition
  from raw r
)
select p.*,
  round(
    (n.weights ->> 'demand')::numeric * p.demand
  + (n.weights ->> 'momentum')::numeric * p.momentum
  + (n.weights ->> 'competition')::numeric * (100 - p.competition)
  ) as score
from pct p
join public.niches n on n.id = p.niche_id;

create view public.v_channel_ypp with (security_invoker = true) as
select
  ch.id as channel_id, ch.title,
  (select subscribers from public.channel_snapshots cs
     where cs.channel_id = ch.id order by captured_at desc limit 1) as subscribers,
  ch.ypp_subs_target,
  round(coalesce((select sum(watch_minutes) from public.channel_daily_stats d
     where d.channel_id = ch.id and d.day > current_date - 365), 0) / 60) as watch_hours_12m,
  ch.ypp_watch_hours_target,
  coalesce((select sum(shorts_views) from public.channel_daily_stats d
     where d.channel_id = ch.id and d.day > current_date - 90), 0) as shorts_views_90d
from public.channels ch;

-- ---------------------------------------------------------------
-- Row level security: dashboard users read/write, jobs use service role
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'niches','seed_terms','channels','channel_snapshots','channel_daily_stats','own_videos',
    'own_video_daily','channel_search_terms','keywords','keyword_snapshots','ext_channels',
    'videos','video_snapshots','video_keywords','competitors','ideas','blotato_posts',
    'job_runs','api_quota_daily','alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy app_users_all on public.%I for all to authenticated using (public.is_app_user()) with check (public.is_app_user())', t);
  end loop;
end $$;

-- tokens and the allow-list: no client access at all (service role only)
alter table public.channel_tokens enable row level security;
alter table public.app_users enable row level security;
