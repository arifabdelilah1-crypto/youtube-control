-- The Costs page: AI calls summed per day, network, model and task, so the dashboard can price them without reading
-- every ai_runs row. A call belongs to the network of its idea; calls without an idea (picking trends, the Clipper)
-- come back with channel_id null. "peak" marks DeepSeek's weekday peak hours (01:00-04:00 and 06:00-10:00 UTC), when
-- its prices double. The prices themselves live in the dashboard (web/app.js AI_PRICES).
create or replace function public.ai_cost_rows(p_since timestamptz)
returns table (day date, channel_id uuid, model text, kind text, peak boolean, runs bigint, prompt_tokens bigint, completion_tokens bigint)
language sql
stable
security definer
set search_path = public
as $$
  select (r.created_at at time zone 'utc')::date as day,
         i.channel_id,
         r.model,
         r.kind,
         (extract(isodow from r.created_at at time zone 'utc') between 1 and 5
           and (extract(hour from r.created_at at time zone 'utc') between 1 and 3
             or extract(hour from r.created_at at time zone 'utc') between 6 and 9)) as peak,
         count(*) as runs,
         coalesce(sum(r.prompt_tokens), 0)::bigint as prompt_tokens,
         coalesce(sum(r.completion_tokens), 0)::bigint as completion_tokens
  from public.ai_runs r
  left join public.ideas i on i.id = r.idea_id
  where r.created_at >= p_since and public.is_app_user()
  group by 1, 2, 3, 4, 5
$$;

revoke all on function public.ai_cost_rows(timestamptz) from public, anon;
grant execute on function public.ai_cost_rows(timestamptz) to authenticated;
