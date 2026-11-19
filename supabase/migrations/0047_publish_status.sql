-- Scheduled posts whose time has passed: YouTube ones are live once the stats sync sees the video (own_videos), and
-- Blotato's (TikTok, Pinterest, Facebook) are asked how they ended. Before this they stayed "scheduled" for ever.
create or replace function public._publish_status() returns void language plpgsql security definer set search_path = public as $$
begin
  update publish_queue q set status = 'published'
  from own_videos o
  where q.platform = 'youtube' and q.status = 'scheduled' and q.slot_at <= now() and o.youtube_video_id = q.youtube_video_id and o.published_at is not null;
  perform net.http_post(url := 'https://pojvaicmeighnpxaixwa.supabase.co/functions/v1/publish',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.get_cron_secret()),
    body := '{"action":"blotato_sync"}'::jsonb, timeout_milliseconds := 120000);
end $$;
select cron.schedule('publish-status', '17 * * * *', 'select public._publish_status()');
