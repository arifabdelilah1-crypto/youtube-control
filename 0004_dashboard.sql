-- Dashboard read models

alter table public.niches add column if not exists trends_anchor text;

create table if not exists public.channel_breakdowns (
  channel_id uuid not null references public.channels(id) on delete cascade,
  period_end date not null,
  kind text not null,          -- traffic_source | country
  key text not null,
  views bigint not null default 0,
  primary key (channel_id, period_end, kind, key)
);
alter table public.channel_breakdowns enable row level security;
create policy app_users_all on public.channel_breakdowns for all to authenticated
  using (public.is_app_user()) with check (public.is_app_user());

-- One row per channel with period totals and the previous period for comparison.
create or replace function public.channel_overview(p_days int default 28)
returns table (
  channel_id uuid, title text, handle text, thumbnail_url text, niche_id uuid, niche_name text,
  language text, connected boolean, subscribers bigint,
  views bigint, views_prev bigint, watch_hours numeric, watch_hours_prev numeric,
  subs_net bigint, subs_net_prev bigint, uploads bigint,
  next_post_at timestamptz, next_post_title text,
  open_critical bigint, open_warning bigint,
  watch_hours_12m numeric, shorts_views_90d numeric
)
language sql stable security invoker set search_path = public
as $$
  select
    c.id, c.title, c.handle, c.thumbnail_url, c.niche_id, n.name, c.language, c.connected,
    (select s.subscribers from channel_snapshots s where s.channel_id = c.id order by s.captured_at desc limit 1),
    coalesce((select sum(d.views) from channel_daily_stats d where d.channel_id = c.id and d.day > current_date - p_days), 0)::bigint,
    coalesce((select sum(d.views) from channel_daily_stats d where d.channel_id = c.id
              and d.day <= current_date - p_days and d.day > current_date - 2 * p_days), 0)::bigint,
    round(coalesce((select sum(d.watch_minutes) from channel_daily_stats d where d.channel_id = c.id and d.day > current_date - p_days), 0) / 60, 1),
    round(coalesce((select sum(d.watch_minutes) from channel_daily_stats d where d.channel_id = c.id
              and d.day <= current_date - p_days and d.day > current_date - 2 * p_days), 0) / 60, 1),
    coalesce((select sum(d.subs_gained - d.subs_lost) from channel_daily_stats d where d.channel_id = c.id and d.day > current_date - p_days), 0)::bigint,
    coalesce((select sum(d.subs_gained - d.subs_lost) from channel_daily_stats d where d.channel_id = c.id
              and d.day <= current_date - p_days and d.day > current_date - 2 * p_days), 0)::bigint,
    (select count(*) from own_videos v where v.channel_id = c.id and v.published_at > now() - make_interval(days => p_days)),
    (select min(b.scheduled_at) from blotato_posts b where b.channel_id = c.id and b.status = 'scheduled' and b.scheduled_at > now()),
    (select b.title from blotato_posts b where b.channel_id = c.id and b.status = 'scheduled' and b.scheduled_at > now()
       order by b.scheduled_at limit 1),
    (select count(*) from alerts a where a.channel_id = c.id and a.resolved_at is null and a.severity = 'critical'),
    (select count(*) from alerts a where a.channel_id = c.id and a.resolved_at is null and a.severity = 'warning'),
    y.watch_hours_12m, y.shorts_views_90d
  from channels c
  left join niches n on n.id = c.niche_id
  left join v_channel_ypp y on y.channel_id = c.id
  order by c.created_at;
$$;

-- Portfolio-wide daily series (sparklines)
create or replace function public.portfolio_daily(p_days int default 28, p_channel uuid default null)
returns table (day date, views bigint, watch_hours numeric, subs_net bigint)
language sql stable security invoker set search_path = public
as $$
  select d.day, sum(d.views)::bigint, round(sum(d.watch_minutes) / 60, 1), sum(d.subs_gained - d.subs_lost)::bigint
  from channel_daily_stats d
  where d.day > current_date - p_days and (p_channel is null or d.channel_id = p_channel)
  group by d.day order by d.day;
$$;

grant execute on function public.channel_overview(int) to authenticated;
grant execute on function public.portfolio_daily(int, uuid) to authenticated;

-- Own videos with latest totals and a multiple vs the channel's typical video of the same format
create or replace view public.v_own_video_latest with (security_invoker = true) as
with latest as (
  select distinct on (youtube_video_id) youtube_video_id, day, views, likes, comments
  from public.own_video_daily order by youtube_video_id, day desc
),
base as (
  select v.channel_id, v.is_short, percentile_cont(0.5) within group (order by l.views) as median_views
  from public.own_videos v join latest l using (youtube_video_id)
  group by v.channel_id, v.is_short
)
select v.youtube_video_id, v.channel_id, v.title, v.published_at, v.duration_s, v.is_short, v.thumbnail_url,
  l.views, l.likes, l.comments, l.day as stats_day,
  round((l.views / nullif(b.median_views, 0))::numeric, 2) as vs_baseline
from public.own_videos v
join latest l using (youtube_video_id)
left join base b on b.channel_id = v.channel_id and b.is_short is not distinct from v.is_short;

-- Competitor watchlist with what we have seen from them
create or replace view public.v_competitors with (security_invoker = true) as
select c.niche_id, c.youtube_channel_id, c.source, e.title, e.subscribers,
  (select count(*) from public.videos v
    where v.youtube_channel_id = c.youtube_channel_id and v.published_at > now() - interval '30 days') as uploads_30d_seen,
  (select count(*) from public.v_video_latest l
    where l.youtube_channel_id = c.youtube_channel_id and l.outlier_score >= 3
      and l.published_at > now() - interval '30 days') as outliers_30d,
  (select l.title from public.v_video_latest l
    where l.youtube_channel_id = c.youtube_channel_id order by l.views desc nulls last limit 1) as best_title,
  (select max(l.views) from public.v_video_latest l where l.youtube_channel_id = c.youtube_channel_id) as best_views
from public.competitors c
join public.ext_channels e on e.youtube_channel_id = c.youtube_channel_id;
