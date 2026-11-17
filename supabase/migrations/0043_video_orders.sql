-- Control center: "Make videos" for a network puts its videos in a queue (video_orders); a cron starts them a few at a time
-- (at most 8 videos being made at once, and only while the AI safety cap has room), with the right maker for each style:
--   stock: real footage (ai auto_start) · mix: real footage + Claude drawings (explainer start) · story: Story stick (story start)
create table public.video_orders (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  style text not null check (style in ('stock', 'mix', 'story')),
  look text,
  publish text not null default 'next' check (publish in ('next', 'ask')),
  length text not null default 'short45',
  status text not null default 'pending' check (status in ('pending', 'started', 'cancelled')),
  started_at timestamptz,
  owner_id uuid,
  created_at timestamptz not null default now()
);
create index video_orders_pending on public.video_orders (status, created_at);
alter table public.video_orders enable row level security;
create policy app_users_all on public.video_orders for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

create or replace function public._start_video_orders() returns int
language plpgsql security definer set search_path = public as $$
declare active int; runs24 int; cap int; o record; started int := 0; lang text; url text; body jsonb;
begin
  select count(*) into active from video_runs where status in ('queued', 'running') and created_at > now() - interval '6 hours';
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
end $$;
revoke all on function public._start_video_orders() from public, anon, authenticated;
grant execute on function public._start_video_orders() to service_role;
select cron.schedule('video-orders', '*/3 * * * *', 'select public._start_video_orders()');
