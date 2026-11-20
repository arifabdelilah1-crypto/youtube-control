-- Several "Make videos" at once each saw 0 active runs (the runs are created a moment later by the functions), so 51 started together
-- and their voice jobs queued for GitHub machines past the time limit. Now one start at a time, and orders started in the last
-- 15 minutes that have no run yet count as active.
create or replace function public._start_video_orders() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare active int; runs24 int; cap int; o record; started int := 0; lang text; url text; body jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('start_video_orders'));
  select count(*) into active from video_runs where status in ('queued', 'running') and created_at > now() - interval '6 hours';
  select active + count(*) into active from video_orders vo where vo.status = 'started' and vo.started_at > now() - interval '15 minutes'
    and not exists (select 1 from video_runs r where r.idea_id = vo.idea_id and r.created_at >= vo.started_at - interval '1 minute');
  select count(*) into runs24 from ai_runs where created_at > now() - interval '24 hours';
  select coalesce((select (value #>> '{}')::int from app_settings where key = 'ai_daily_runs'), 400) into cap;
  for o in select * from video_orders where status = 'pending' order by created_at limit 20 loop
    exit when active + started >= 8;
    exit when runs24 + (started + 1) * 18 > cap * 0.9;
    select coalesce(video_style->>'language', language) into lang from channels where id = o.channel_id;
    if o.style = 'story' then
      url := 'story';
      body := jsonb_build_object('action','start','idea_id',o.idea_id,'channel_id',o.channel_id,'options',
        jsonb_build_object('look',coalesce(o.look,'noir'),'length',o.length,'aspect','9:16','publish',o.publish,'music',false,'language',lang));
    elsif o.style = 'mix' then
      url := 'explainer';
      body := jsonb_build_object('action','start','idea_id',o.idea_id,'channel_id',o.channel_id,'options',
        jsonb_build_object('video_style','mix','look',coalesce(o.look,'glow'),'length',o.length,'aspect','9:16','publish',o.publish,'music',false,'ai_model','claude-sonnet-5-5','language',lang));
    else
      url := 'ai';
      body := jsonb_build_object('action','auto_start','idea_id',o.idea_id,'channel_id',o.channel_id,'options',
        jsonb_build_object('language',lang,'aspect','9:16','length',o.length,'music',false,'sounds',false,'publish',o.publish));
    end if;
    perform net.http_post(url := 'https://pojvaicmeighnpxaixwa.supabase.co/functions/v1/' || url,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()), body := body, timeout_milliseconds := 60000);
    update video_orders set status = 'started', started_at = now() where id = o.id;
    started := started + 1;
  end loop;
  return started;
end $function$;
