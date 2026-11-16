-- Instagram Reels published directly (Graph API, through the Instagram professional account linked to a Facebook Page
-- connected with Connect Facebook). The target is {platform:"instagram", method:"meta", page_id} in publish_schedules.targets.
-- The API can't schedule a Reel, so a queued Reel waits for its slot: every 5 minutes, pg_cron asks the publish function
-- (action dispatch_due) to start the upload job of the Reels whose slot has come, 5 at a time.
alter table public.publish_queue add column if not exists platform_post_id text;  -- Instagram media id (and other platforms' ids later)

create index if not exists publish_queue_due on public.publish_queue (slot_at) where status = 'queued';

select cron.unschedule('instagram-dispatch') where exists (select 1 from cron.job where jobname = 'instagram-dispatch');
select cron.schedule('instagram-dispatch', '*/5 * * * *', $$
  select public.call_edge('publish', '{"action":"dispatch_due"}'::jsonb)
  where exists (select 1 from public.publish_queue
                where platform = 'instagram' and method = 'meta' and status = 'queued' and slot_at <= now() + interval '2 minutes')
$$);
