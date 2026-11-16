-- Facebook connection health. When Meta stops accepting a Page's token (OAuthException 190 / 200 / 10, or "Cannot call API
-- for app … on behalf of user …"), the publish job marks the Page as needing a reconnect (mark_meta_page_broken) and an
-- alert shows at once on Home and on the network's page. Reconnecting (meta-oauth → store_meta_page) clears both.
-- The failed posts stay failed; "Send again" on the network's page re-queues them (publish function, action resend_meta).
alter table public.meta_pages add column if not exists needs_reconnect boolean not null default false;
alter table public.meta_pages add column if not exists reconnect_error text;
alter table public.meta_pages add column if not exists reconnect_since timestamptz;
grant select (needs_reconnect, reconnect_error, reconnect_since) on public.meta_pages to authenticated;

-- a reconnect clears the flag and its alert
create or replace function public.store_meta_page(p_page_id text, p_name text, p_picture text, p_category text,
  p_ig_user_id text, p_ig_username text, p_token text, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  select vault_secret_id into v_id from public.meta_pages where page_id = p_page_id;
  if v_id is null then
    v_id := vault.create_secret(p_token, 'meta_page_' || p_page_id, 'Facebook Page access token');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
  insert into public.meta_pages (page_id, name, picture_url, category, ig_user_id, ig_username, vault_secret_id, connected_by, updated_at)
  values (p_page_id, p_name, p_picture, p_category, p_ig_user_id, p_ig_username, v_id, p_user, now())
  on conflict (page_id) do update set name = excluded.name, picture_url = excluded.picture_url, category = excluded.category,
    ig_user_id = excluded.ig_user_id, ig_username = excluded.ig_username, vault_secret_id = excluded.vault_secret_id,
    connected_by = excluded.connected_by, updated_at = now(),
    needs_reconnect = false, reconnect_error = null, reconnect_since = null;
  update public.alerts set resolved_at = now() where dedupe_key = 'meta_auth:' || p_page_id and resolved_at is null;
end;
$$;

create or replace view public.v_fired_alerts as
 WITH last_sync AS (
         SELECT job_runs.details
           FROM job_runs
          WHERE job_runs.job = 'channel_sync'::text AND job_runs.finished_at IS NOT NULL
          ORDER BY job_runs.started_at DESC
         LIMIT 1
        ), sync_errors AS (
         SELECT c.id AS channel_id,
            c.title,
            e.value ->> 'error'::text AS error
           FROM last_sync s,
            LATERAL jsonb_each(s.details) e(key, value)
             JOIN channels c ON c.title = e.key
          WHERE jsonb_typeof(e.value) = 'object'::text AND e.value ? 'error'::text
        ), expected(job, label, max_hours) AS (
         VALUES ('research'::text,'Research'::text,36), ('trends'::text,'Trends'::text,36), ('channel_sync'::text,'Channel stats'::text,12)
        ), last_run AS (
         SELECT x.job,
            x.label,
            x.max_hours,
            r.status,
            r.started_at,
            EXTRACT(epoch FROM now() - r.started_at) / 3600::numeric AS hours
           FROM expected x
             JOIN LATERAL ( SELECT j.status,
                    j.started_at
                   FROM job_runs j
                  WHERE j.job = x.job
                  ORDER BY j.started_at DESC
                 LIMIT 1) r ON true
        )
 SELECT 'critical'::text AS severity,
    sync_errors.title || ': Google connection expired'::text AS title,
    'Its YouTube stats have stopped and direct YouTube publishing will fail. Reconnect it on its Networks page.'::text AS detail,
    sync_errors.channel_id,
    'google_token:'::text || sync_errors.channel_id AS dedupe_key
   FROM sync_errors
  WHERE sync_errors.error ~~* '%token%'::text
UNION ALL
 SELECT 'warning'::text AS severity,
    sync_errors.title || ': stats sync failed'::text AS title,
    "left"(sync_errors.error, 200) AS detail,
    sync_errors.channel_id,
    'sync_error:'::text || sync_errors.channel_id AS dedupe_key
   FROM sync_errors
  WHERE sync_errors.error !~~* '%token%'::text
UNION ALL
 SELECT 'warning'::text AS severity,
    last_run.label || ' job failed'::text AS title,
    'Open Settings to see its last run.'::text AS detail,
    NULL::uuid AS channel_id,
    'job_failed:'::text || last_run.job AS dedupe_key
   FROM last_run
  WHERE last_run.status = 'failed'::text
UNION ALL
 SELECT 'warning'::text AS severity,
    last_run.label || ' job is stuck'::text AS title,
    ('It has been running for '::text || floor(last_run.hours)) || ' h. Open Settings to see it.'::text AS detail,
    NULL::uuid AS channel_id,
    'job_stuck:'::text || last_run.job AS dedupe_key
   FROM last_run
  WHERE last_run.status = 'running'::text AND last_run.hours > 3::numeric
UNION ALL
 SELECT 'warning'::text AS severity,
    last_run.label || ' job has not run'::text AS title,
    ('Nothing for '::text || floor(last_run.hours)) || ' h. GitHub may have stopped its schedule.'::text AS detail,
    NULL::uuid AS channel_id,
    'job_stale:'::text || last_run.job AS dedupe_key
   FROM last_run
  WHERE last_run.status <> 'running'::text AND last_run.hours > last_run.max_hours::numeric
UNION ALL
 SELECT 'critical'::text AS severity,
    'Post failed: '::text || "left"(q.title, 80) AS title,
    ((COALESCE(q.platform, 'youtube'::text) || ': '::text) || rtrim("left"(COALESCE(q.error, 'No reason given'::text), 180), '. '::text)) || '. Retry it on the Publish page.'::text AS detail,
    q.channel_id,
    'post_failed:'::text || q.id AS dedupe_key
   FROM publish_queue q
  WHERE q.status = 'failed'::text
UNION ALL
 SELECT 'critical'::text AS severity,
    'Post stuck: '::text || "left"(q.title, 80) AS title,
    COALESCE(q.platform, 'youtube'::text) || ': it should have left by now. Check it on the Publish page.'::text AS detail,
    q.channel_id,
    'post_stuck:'::text || q.id AS dedupe_key
   FROM publish_queue q
  WHERE q.status = 'uploading'::text AND q.updated_at < (now() - '01:00:00'::interval) OR q.status = 'queued'::text AND COALESCE(q.slot_at, q.created_at) < (now() - '01:00:00'::interval)
UNION ALL
 SELECT 'warning'::text AS severity,
    'Video stuck: '::text || "left"(COALESCE(i.video_title, i.title), 80) AS title,
    'Nothing has moved for over an hour. Stop it on the Ideas page and try again.'::text AS detail,
    r.channel_id,
    'video_stuck:'::text || r.id AS dedupe_key
   FROM video_runs r
     JOIN ideas i ON i.id = r.idea_id
  WHERE (r.status = ANY (ARRAY['queued'::text, 'running'::text])) AND r.updated_at < (now() - '01:00:00'::interval)
UNION ALL
 SELECT 'warning'::text AS severity,
    'YouTube quota almost used up'::text AS title,
    quota_used_today('youtube_data'::text) || ' of 10,000 units used today.'::text AS detail,
    NULL::uuid AS channel_id,
    'quota:'::text || CURRENT_DATE AS dedupe_key
  WHERE quota_used_today('youtube_data'::text) >= 9000
UNION ALL
 SELECT 'warning'::text AS severity,
    'Reconnect Facebook: '::text || p.name AS title,
    'Meta stopped accepting this Page''s connection, so its Facebook posts fail. Click Reconnect Facebook on the network''s page, then Send again.'::text AS detail,
    ( SELECT s.channel_id
           FROM publish_schedules s
          WHERE s.targets @> jsonb_build_array(jsonb_build_object('platform', 'facebook', 'method', 'meta', 'page_id', p.page_id))
          ORDER BY s.channel_id
         LIMIT 1) AS channel_id,
    'meta_auth:'::text || p.page_id AS dedupe_key
   FROM meta_pages p
  WHERE p.needs_reconnect;
revoke all on public.v_fired_alerts from public, anon, authenticated;

-- the publish job (service role): Meta refused this Page's token
create or replace function public.mark_meta_page_broken(p_page_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meta_pages set needs_reconnect = true, reconnect_error = left(coalesce(p_error, ''), 500),
    reconnect_since = coalesce(reconnect_since, now())
  where page_id = p_page_id;
  if not found then return; end if;
  insert into public.alerts (severity, title, detail, channel_id, dedupe_key)
    select f.severity, f.title, f.detail, f.channel_id, f.dedupe_key from public.v_fired_alerts f where f.dedupe_key = 'meta_auth:' || p_page_id
    on conflict (dedupe_key) where resolved_at is null do nothing;
end;
$$;
revoke all on function public.mark_meta_page_broken(text, text) from public, anon, authenticated;
grant execute on function public.mark_meta_page_broken(text, text) to service_role;

-- the Pages whose posts already failed this way (Nov 15-16) need a reconnect too
update public.meta_pages p set needs_reconnect = true, reconnect_since = f.first_at, reconnect_error = f.err
from (
  select (x->>'page_id') as page_id, min(q.updated_at) as first_at, max(q.error) as err
  from public.publish_queue q
  join public.publish_schedules s on s.channel_id = q.channel_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.targets) = 'array' then s.targets else '[]'::jsonb end) x
  where q.method = 'meta' and q.status = 'failed' and x->>'platform' = 'facebook' and x->>'method' = 'meta'
    and q.error ~* '(cannot call api for app|oauthexception|access token|session has expired|error validating)'
  group by 1
) f
where p.page_id = f.page_id and f.first_at > p.updated_at;
select public.refresh_alerts();
