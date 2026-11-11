-- The MCP connection: personal tokens that let Claude (or any AI app that speaks MCP) use the app from outside,
-- through the `mcp` edge function. A token is made in Settings and shown once; only its SHA-256 hash is kept.
-- It works only while the account that made it is still on the allow-list, and anyone on the team can revoke it.

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  token_hash text not null unique,          -- hex SHA-256 of the whole token
  prefix text not null,                     -- its first characters, to recognise it in the list
  email text not null,                      -- who made it
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  uses bigint not null default 0,
  revoked_at timestamptz
);
alter table public.mcp_tokens enable row level security;  -- no policies: through the functions below only

-- makes a token and returns it, the only time it can be seen
create or replace function public.create_mcp_token(p_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_token text;
begin
  if not public.is_app_user() then raise exception 'not allowed'; end if;
  if v_name = '' then raise exception 'Give the token a name, e.g. "Claude on my Mac".'; end if;
  if (select count(*) from public.mcp_tokens where revoked_at is null) >= 20 then
    raise exception 'There are already 20 tokens: revoke one first.';
  end if;
  v_token := 'sv_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.mcp_tokens (name, token_hash, prefix, email, created_by)
  values (v_name, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(v_token, 9), v_email, auth.uid());
  return v_token;
end $$;

create or replace function public.mcp_token_list()
returns table (id uuid, name text, prefix text, email text, created_at timestamptz, last_used_at timestamptz, uses bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.prefix, t.email, t.created_at, t.last_used_at, t.uses
  from public.mcp_tokens t
  where t.revoked_at is null and public.is_app_user()
  order by t.created_at desc
$$;

create or replace function public.revoke_mcp_token(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_user() then raise exception 'not allowed'; end if;
  update public.mcp_tokens set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

-- the mcp function only: checks a token's hash, counts the use, and says who it belongs to
create or replace function public.mcp_token_use(p_hash text)
returns table (id uuid, name text, email text)
language sql volatile security definer set search_path = public as $$
  update public.mcp_tokens t set last_used_at = now(), uses = t.uses + 1
  where t.token_hash = p_hash and t.revoked_at is null
    and exists (select 1 from public.app_users u where lower(u.email) = lower(t.email))
  returning t.id, t.name, t.email
$$;

revoke all on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;
revoke all on function public.mcp_token_list() from public, anon;
grant execute on function public.mcp_token_list() to authenticated;
revoke all on function public.revoke_mcp_token(uuid) from public, anon;
grant execute on function public.revoke_mcp_token(uuid) to authenticated;
revoke all on function public.mcp_token_use(text) from public, anon, authenticated;
grant execute on function public.mcp_token_use(text) to service_role;
