-- Outlier score fix. A missing channel figure fell back to 100, so "views ÷ the channel's usual views" became
-- "views ÷ 100" whenever usual views were unknown (all 620 tracked videos): 617 of them counted as outliers and
-- a 284M-view video scored 2,844,883×. Each signal now only counts when its channel figure is known.
create or replace view public.v_video_latest with (security_invoker = true) as
select distinct on (v.youtube_video_id)
  v.youtube_video_id, v.niche_id, v.title, v.published_at, v.is_short, v.thumbnail_url,
  v.youtube_channel_id, c.title as channel_title, c.subscribers, c.median_recent_views,
  s.views, s.likes, s.comments, s.captured_at,
  -- outlier: views vs channel size and vs channel's usual views; the stronger known signal wins (null when neither is known)
  round(greatest(
    case when c.subscribers > 0 then s.views::numeric / greatest(c.subscribers, 100) end,
    case when c.median_recent_views > 0 then s.views::numeric / greatest(c.median_recent_views, 100) end
  ), 2) as outlier_score,
  round(s.views::numeric / greatest(extract(epoch from (s.captured_at - v.published_at)) / 3600, 1), 1) as views_per_hour,
  round((coalesce(s.likes, 0) + coalesce(s.comments, 0))::numeric / greatest(s.views, 1) * 100, 2) as engagement_pct
from public.videos v
join public.video_snapshots s using (youtube_video_id)
left join public.ext_channels c on c.youtube_channel_id = v.youtube_channel_id
order by v.youtube_video_id, s.captured_at desc;
