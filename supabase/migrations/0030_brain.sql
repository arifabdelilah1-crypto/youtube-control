-- The Brain (phase 1): one brain per network plus one general brain, each with its own memory, its conversation
-- and the actions it proposes. The AI keys it uses are pasted in Settings and kept encrypted in Supabase Vault:
-- the dashboard can save or remove a key and see its last four characters, never read it back; only the server
-- functions (service role) can decrypt one.

-- ---------- AI keys ----------
create table if not exists public.ai_keys (
  provider text primary key check (provider in ('deepseek', 'openai', 'anthropic')),
  secret_id uuid not null,
  last4 text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.ai_keys enable row level security;  -- no policies: read through the functions below only

create or replace function public.ai_key_status()
returns table (provider text, last4 text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select k.provider, k.last4, k.updated_at from public.ai_keys k where public.is_app_user()
$$;

-- an empty key removes the provider's key
create or replace function public.set_ai_key(p_provider text, p_key text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_key text := btrim(coalesce(p_key, ''));
begin
  if not public.is_app_user() then raise exception 'not allowed'; end if;
  if p_provider not in ('deepseek', 'openai', 'anthropic') then raise exception 'unknown provider'; end if;
  select secret_id into v_id from public.ai_keys where provider = p_provider;
  if v_key = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    delete from public.ai_keys where provider = p_provider;
    return;
  end if;
  if length(v_key) < 20 or length(v_key) > 300 or v_key ~ '\s' then raise exception 'That does not look like an API key.'; end if;
  if v_id is null then
    v_id := vault.create_secret(v_key, 'ai_key_' || p_provider || '_' || substr(md5(random()::text), 1, 6), 'Brain AI key: ' || p_provider);
  else
    perform vault.update_secret(v_id, v_key);
  end if;
  insert into public.ai_keys (provider, secret_id, last4, updated_at, updated_by)
  values (p_provider, v_id, right(v_key, 4), now(), auth.uid())
  on conflict (provider) do update set secret_id = excluded.secret_id, last4 = excluded.last4, updated_at = now(), updated_by = auth.uid();
end $$;

-- the server functions only
create or replace function public.ai_key_for(p_provider text)
returns text
language sql stable security definer set search_path = public as $$
  select s.decrypted_secret from public.ai_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.provider = p_provider
$$;

revoke all on function public.ai_key_status() from public, anon;
grant execute on function public.ai_key_status() to authenticated;
revoke all on function public.set_ai_key(text, text) from public, anon;
grant execute on function public.set_ai_key(text, text) to authenticated;
revoke all on function public.ai_key_for(text) from public, anon, authenticated;
grant execute on function public.ai_key_for(text) to service_role;

-- ---------- brains ----------
create table if not exists public.brains (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid unique references public.channels(id) on delete cascade,  -- null: the general brain, for every network
  provider text not null default 'deepseek' check (provider in ('deepseek', 'openai', 'anthropic')),
  model text,
  autonomy text not null default 'propose' check (autonomy in ('propose', 'prepare', 'auto')),
  instructions text not null default '',  -- the standing rules the user gives this brain
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists brains_one_general on public.brains ((channel_id is null)) where channel_id is null;

-- everything the brain knows: facts, rules, preferences, lessons, and the events the app logs for it
create table if not exists public.brain_memory (
  id uuid primary key default gen_random_uuid(),
  brain_id uuid not null references public.brains(id) on delete cascade,
  kind text not null default 'fact' check (kind in ('fact', 'rule', 'preference', 'lesson', 'profile', 'event')),
  content text not null check (length(content) between 1 and 2000),
  source text not null default 'chat',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('simple', content)) stored
);
create index if not exists brain_memory_brain on public.brain_memory (brain_id, created_at desc);
create index if not exists brain_memory_fts on public.brain_memory using gin (fts);

-- the whole conversation, kept
create table if not exists public.brain_messages (
  id uuid primary key default gen_random_uuid(),
  brain_id uuid not null references public.brains(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  meta jsonb not null default '{}'::jsonb,  -- tools used, model, tokens, cost
  owner_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists brain_messages_brain on public.brain_messages (brain_id, created_at desc);

-- what the brain wants to do that costs money or reaches the outside: waits for a yes
create table if not exists public.brain_actions (
  id uuid primary key default gen_random_uuid(),
  brain_id uuid not null references public.brains(id) on delete cascade,
  message_id uuid references public.brain_messages(id) on delete set null,
  kind text not null,
  args jsonb not null default '{}'::jsonb,
  summary text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'done', 'rejected', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index if not exists brain_actions_brain on public.brain_actions (brain_id, created_at desc);

alter table public.brains enable row level security;
alter table public.brain_memory enable row level security;
alter table public.brain_messages enable row level security;
alter table public.brain_actions enable row level security;
create policy app_users_all on public.brains for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy app_users_all on public.brain_memory for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy app_users_all on public.brain_messages for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
-- actions are decided through the brain function, so the dashboard only reads them
create policy app_users_read on public.brain_actions for select to authenticated using (public.is_app_user());

drop trigger if exists brains_touch on public.brains;
create trigger brains_touch before update on public.brains for each row execute function public.touch_updated_at();

-- ---------- the app writes its own events into the right brain ----------
create or replace function public.brain_of(p_channel uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_channel is null then
    select id into v_id from public.brains where channel_id is null;
    if v_id is null then insert into public.brains (channel_id) values (null) returning id into v_id; end if;
  else
    select id into v_id from public.brains where channel_id = p_channel;
    if v_id is null then insert into public.brains (channel_id) values (p_channel) on conflict (channel_id) do nothing returning id into v_id; end if;
    if v_id is null then select id into v_id from public.brains where channel_id = p_channel; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.brain_of(uuid) from public, anon;
grant execute on function public.brain_of(uuid) to authenticated, service_role;

create or replace function public.brain_log_event()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_text text;
begin
  if tg_table_name = 'channels' then
    perform public.brain_of(new.id);
    insert into public.brain_memory (brain_id, kind, content, source)
    values (public.brain_of(null), 'event', format('New network added: %s (language %s).', coalesce(new.title, 'untitled'), coalesce(new.language, '?')), 'app');
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
    insert into public.brain_memory (brain_id, kind, content, source) values (public.brain_of(new.channel_id), 'event', v_text, 'app');
  end if;
  return new;
end $$;

drop trigger if exists brain_event on public.video_runs;
create trigger brain_event after update of status on public.video_runs for each row execute function public.brain_log_event();
drop trigger if exists brain_event on public.publish_queue;
create trigger brain_event after update of status on public.publish_queue for each row execute function public.brain_log_event();
drop trigger if exists brain_event on public.channels;
create trigger brain_event after insert on public.channels for each row execute function public.brain_log_event();
