-- The image AI key (Alibaba Cloud Model Studio / DashScope) for painted scenes, saved like the Brain's keys: in Vault, set from Settings,
-- read only by the server (ai_key_for, service role).
alter table public.ai_keys drop constraint if exists ai_keys_provider_check;
alter table public.ai_keys add constraint ai_keys_provider_check check (provider in ('deepseek', 'openai', 'anthropic', 'alibaba'));

create or replace function public.set_ai_key(p_provider text, p_key text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_key text := btrim(coalesce(p_key, ''));
begin
  if not public.is_app_user() then raise exception 'not allowed'; end if;
  if p_provider not in ('deepseek', 'openai', 'anthropic', 'alibaba') then raise exception 'unknown provider'; end if;
  select secret_id into v_id from public.ai_keys where provider = p_provider;
  if v_key = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    delete from public.ai_keys where provider = p_provider;
    return;
  end if;
  if length(v_key) < 20 or length(v_key) > 300 or v_key ~ '\s' then raise exception 'That does not look like an API key.'; end if;
  if v_id is null then
    v_id := vault.create_secret(v_key, 'ai_key_' || p_provider || '_' || substr(md5(random()::text), 1, 6), 'AI key: ' || p_provider);
  else
    perform vault.update_secret(v_id, v_key);
  end if;
  insert into public.ai_keys (provider, secret_id, last4, updated_at, updated_by)
  values (p_provider, v_id, right(v_key, 4), now(), auth.uid())
  on conflict (provider) do update set secret_id = excluded.secret_id, last4 = excluded.last4, updated_at = now(), updated_by = auth.uid();
end $$;
