-- The brain's event log must never block the app: if writing the event fails, the video or the post still
-- changes status, and the event is simply not logged.
create or replace function public.brain_log_event()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_text text;
begin
  begin
    if tg_table_name = 'channels' then
      perform public.brain_of(new.id);
      insert into public.brain_memory (brain_id, kind, content, source)
      values (public.brain_of(null), 'event', left(format('New network added: %s (language %s).', coalesce(new.title, 'untitled'), coalesce(new.language, '?')), 2000), 'app');
      return new;
    end if;
    if tg_table_name = 'video_runs' then
      if new.status is not distinct from old.status or new.status not in ('ready', 'review', 'failed') then return new; end if;
      select coalesce(video_title, title) into v_title from public.ideas where id = new.idea_id;
      v_text := format('Video %s: "%s"%s%s.',
        case new.status when 'failed' then 'failed' when 'review' then 'ready, with things to check' else 'ready' end,
        coalesce(v_title, 'untitled'),
        case when new.options->>'video_style' = 'explainer' then format(' (animation, %s, %s)', coalesce(new.options->>'look', 'glow'), coalesce(new.options->>'aspect', '9:16')) else '' end,
        case when new.status = 'failed' and new.error is not null then ' Error: ' || left(new.error, 200) else '' end);
    elsif tg_table_name = 'publish_queue' then
      if new.status is not distinct from old.status or new.status not in ('published', 'failed') then return new; end if;
      v_text := format('%s on %s: "%s"%s.', case when new.status = 'published' then 'Published' else 'Publishing failed' end,
        coalesce(new.platform, 'youtube'), coalesce(new.title, 'untitled'),
        case when new.status = 'failed' and new.error is not null then ' Error: ' || left(new.error, 200) else '' end);
    else
      return new;
    end if;
    if new.channel_id is not null then
      insert into public.brain_memory (brain_id, kind, content, source) values (public.brain_of(new.channel_id), 'event', left(v_text, 2000), 'app');
    end if;
  exception when others then
    raise warning 'brain_log_event: %', sqlerrm;
  end;
  return new;
end $$;
