-- ideas.sources is a list of {type, ...}. Anything saved as an object (the first Long to Shorts version did) is turned into a list,
-- so the Ideas page and the AI never break on it.
create or replace function public.ideas_sources_list() returns trigger language plpgsql as $$
begin
  if new.sources is null then
    new.sources := '[]'::jsonb;
  elsif jsonb_typeof(new.sources) = 'object' then
    new.sources := coalesce((select jsonb_agg(case when jsonb_typeof(v) = 'object' then jsonb_build_object('type', k) || v else jsonb_build_object('type', k, 'ref', v) end)
                             from jsonb_each(new.sources) as e(k, v)), '[]'::jsonb);
  elsif jsonb_typeof(new.sources) <> 'array' then
    new.sources := '[]'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists ideas_sources_list on public.ideas;
create trigger ideas_sources_list before insert or update of sources on public.ideas for each row execute function public.ideas_sources_list();
