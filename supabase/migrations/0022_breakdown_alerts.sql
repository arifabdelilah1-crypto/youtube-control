-- Breakdown alerts, worked out inside the database every 15 minutes: nothing here depends on GitHub's schedule,
-- so a job that stops running still gets noticed. An alert closes by itself once its cause is gone.

create or replace view public.v_fired_alerts as
  -- a network's Google connection, as the last stats sync saw it
  with last_sync as (
    select details from public.job_runs where job = 'channel_sync' and finished_at is not null order by started_at desc limit 1
  ),
  sync_errors as (
    select c.id as channel_id, c.title, e.value->>'error' as error
    from last_sync s, jsonb_each(s.details) e join public.channels c on c.title = e.key
    where jsonb_typeof(e.value) = 'object' and e.value ? 'error'
  ),
  expected(job, label, max_hours) as (
    values ('research', 'Research', 36), ('trends', 'Trends', 36), ('channel_sync', 'Channel stats', 12)
  ),
  last_run as (
    select x.job, x.label, x.max_hours, r.status, r.started_at, extract(epoch from now() - r.started_at) / 3600 as hours
    from expected x
    join lateral (select status, started_at from public.job_runs j where j.job = x.job order by started_at desc limit 1) r on true
  )
  select 'critical'::text as severity, title || ': Google connection expired' as title,
    'Its YouTube stats have stopped and direct YouTube publishing will fail. Reconnect it on its Networks page.' as detail,
    channel_id, 'google_token:' || channel_id as dedupe_key
  from sync_errors where error ilike '%token%'
  union all
  select 'warning', title || ': stats sync failed', left(error, 200), channel_id, 'sync_error:' || channel_id
  from sync_errors where error not ilike '%token%'
  union all
  select 'warning', label || ' job failed', 'Open Settings to see its last run.', null, 'job_failed:' || job
  from last_run where status = 'failed'
  union all
  select 'warning', label || ' job is stuck', 'It has been running for ' || floor(hours) || ' h. Open Settings to see it.', null, 'job_stuck:' || job
  from last_run where status = 'running' and hours > 3
  union all
  select 'warning', label || ' job has not run', 'Nothing for ' || floor(hours) || ' h. GitHub may have stopped its schedule.', null, 'job_stale:' || job
  from last_run where status <> 'running' and hours > max_hours
  union all
  select 'critical', 'Post failed: ' || left(q.title, 80), coalesce(q.platform, 'youtube') || ': ' || rtrim(left(coalesce(q.error, 'No reason given'), 180), '. ') || '. Retry it on the Publish page.',
    q.channel_id, 'post_failed:' || q.id
  from public.publish_queue q where q.status = 'failed'
  union all
  select 'critical', 'Post stuck: ' || left(q.title, 80), coalesce(q.platform, 'youtube') || ': it should have left by now. Check it on the Publish page.',
    q.channel_id, 'post_stuck:' || q.id
  from public.publish_queue q
  where (q.status = 'uploading' and q.updated_at < now() - interval '1 hour')
     or (q.status = 'queued' and coalesce(q.slot_at, q.created_at) < now() - interval '1 hour')
  union all
  select 'warning', 'Video stuck: ' || left(coalesce(i.video_title, i.title), 80), 'Nothing has moved for over an hour. Stop it on the Ideas page and try again.',
    r.channel_id, 'video_stuck:' || r.id
  from public.video_runs r join public.ideas i on i.id = r.idea_id
  where r.status in ('queued', 'running') and r.updated_at < now() - interval '1 hour'
  union all
  select 'warning', 'YouTube quota almost used up', public.quota_used_today('youtube_data') || ' of 10,000 units used today.', null, 'quota:' || current_date
  where public.quota_used_today('youtube_data') >= 9000;

revoke all on public.v_fired_alerts from public, anon, authenticated;

create or replace function public.refresh_alerts() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.alerts a set resolved_at = now()
    where a.resolved_at is null and a.dedupe_key is not null
      and not exists (select 1 from public.v_fired_alerts f where f.dedupe_key = a.dedupe_key);
  update public.alerts a set title = f.title, detail = f.detail, severity = f.severity
    from public.v_fired_alerts f
    where a.resolved_at is null and a.dedupe_key = f.dedupe_key;
  insert into public.alerts (severity, title, detail, channel_id, dedupe_key)
    select f.severity, f.title, f.detail, f.channel_id, f.dedupe_key from public.v_fired_alerts f
    on conflict (dedupe_key) where resolved_at is null do nothing;
end $$;

revoke all on function public.refresh_alerts() from public, anon, authenticated;

select cron.schedule('refresh-alerts', '*/15 * * * *', $$ select public.refresh_alerts() $$);
