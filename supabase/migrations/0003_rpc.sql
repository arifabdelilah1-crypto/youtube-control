-- Server-side helpers. Only the service role (jobs, edge functions) may call them.
create extension if not exists supabase_vault with schema vault;

create or replace function public.add_quota(p_api text, p_bucket text, p_niche_key text, p_units int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.api_quota_daily (day, api, bucket, niche_key, units)
  values (current_date, p_api, p_bucket, coalesce(p_niche_key, 'all'), p_units)
  on conflict (day, api, bucket, niche_key)
  do update set units = public.api_quota_daily.units + excluded.units;
$$;

create or replace function public.quota_used_today(p_api text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(units), 0)::int from public.api_quota_daily
  where day = current_date and api = p_api;
$$;

create or replace function public.store_channel_refresh_token(p_channel_id uuid, p_token text, p_scopes text[])
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  select vault_secret_id into v_id from public.channel_tokens where channel_id = p_channel_id;
  if v_id is null then
    v_id := vault.create_secret(p_token, 'yt_refresh_' || p_channel_id::text, 'YouTube OAuth refresh token');
    insert into public.channel_tokens (channel_id, vault_secret_id, scopes) values (p_channel_id, v_id, p_scopes);
  else
    perform vault.update_secret(v_id, p_token);
    update public.channel_tokens set scopes = p_scopes, updated_at = now() where channel_id = p_channel_id;
  end if;
  update public.channels set connected = true where id = p_channel_id;
end;
$$;

create or replace function public.get_channel_refresh_token(p_channel_id uuid)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select d.decrypted_secret
  from public.channel_tokens t
  join vault.decrypted_secrets d on d.id = t.vault_secret_id
  where t.channel_id = p_channel_id;
$$;

revoke all on function public.add_quota(text, text, text, int) from public, anon, authenticated;
revoke all on function public.quota_used_today(text) from public, anon, authenticated;
revoke all on function public.store_channel_refresh_token(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.get_channel_refresh_token(uuid) from public, anon, authenticated;
grant execute on function public.add_quota(text, text, text, int) to service_role;
grant execute on function public.quota_used_today(text) to service_role;
grant execute on function public.store_channel_refresh_token(uuid, text, text[]) to service_role;
grant execute on function public.get_channel_refresh_token(uuid) to service_role;
