-- Thumbnail impressions + click-through rate per video per day, from the YouTube Reporting API
-- (bulk report channel_reach_basic_a1). Daily files about 2 days behind; the first ones arrive
-- ~48 h after a channel's reporting job is created, with the 30 days before that backfilled.
-- No foreign key to own_videos: reports also cover older uploads that own_videos doesn't track.

create table if not exists public.own_video_impressions (
  youtube_video_id text not null,
  channel_id uuid not null references public.channels(id) on delete cascade,
  day date not null,
  impressions bigint not null default 0,
  ctr numeric,                 -- fraction: 0.05 = 5 %
  primary key (youtube_video_id, day)
);
create index if not exists own_video_impressions_channel on public.own_video_impressions (channel_id, day);
alter table public.own_video_impressions enable row level security;
create policy app_users_all on public.own_video_impressions for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

alter table public.channels
  add column if not exists stats_synced_at timestamptz,     -- last finished sync ("Refresh" or the 6-hourly job)
  add column if not exists reach_job_id text,               -- Reporting API job id for channel_reach_basic_a1
  add column if not exists reach_report_after timestamptz,  -- createTime of the newest report already imported
  add column if not exists reach_error text;                -- why impressions can't be imported (shown in the dashboard)
-- channels synced before this column existed: their last video refresh
update public.channels c set stats_synced_at = (select max(v.updated_at) from public.own_videos v where v.channel_id = c.id)
where stats_synced_at is null;

-- Same view as before, plus impressions and CTR over the last 28 days of reports and the time of the last refresh.
create or replace view public.v_own_video_latest with (security_invoker = true) as
with latest as (
  select distinct on (youtube_video_id) youtube_video_id, day, views, likes, comments
  from public.own_video_daily order by youtube_video_id, day desc
),
base as (
  select v.channel_id, v.is_short, percentile_cont(0.5) within group (order by l.views) as median_views
  from public.own_videos v join latest l using (youtube_video_id)
  group by v.channel_id, v.is_short
),
reach as (
  select youtube_video_id, sum(impressions) as impressions,
    sum(impressions * ctr) / nullif(sum(impressions) filter (where ctr is not null), 0) as ctr
  from public.own_video_impressions where day > current_date - 30
  group by youtube_video_id
)
select v.youtube_video_id, v.channel_id, v.title, v.published_at, v.duration_s, v.is_short, v.thumbnail_url,
  l.views, l.likes, l.comments, l.day as stats_day,
  round((l.views / nullif(b.median_views, 0))::numeric, 2) as vs_baseline,
  r.impressions as impressions_28d, round(r.ctr, 4) as ctr_28d, v.updated_at as stats_updated_at
from public.own_videos v
join latest l using (youtube_video_id)
left join base b on b.channel_id = v.channel_id and b.is_short is not distinct from v.is_short
left join reach r using (youtube_video_id);
