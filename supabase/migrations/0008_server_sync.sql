-- Server-side scheduling: pg_cron calls the channel-sync edge function every 6 hours.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Shared secret between pg_cron and the edge function, kept in Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'pg_cron -> edge functions');
  end if;
end $$;

create or replace function public.get_cron_secret()
returns text
language sql stable security definer set search_path = public, vault
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'; $$;
revoke all on function public.get_cron_secret() from public, anon, authenticated;
grant execute on function public.get_cron_secret() to service_role;

-- Helper that pg_cron (and the OAuth callback via SQL) can use to trigger an edge function.
create or replace function public.call_edge(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language sql security definer set search_path = public, vault, net
as $$
  select net.http_post(
    url := 'https://pojvaicmeighnpxaixwa.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := p_body,
    timeout_milliseconds := 120000);
$$;
revoke all on function public.call_edge(text, jsonb) from public, anon, authenticated;
grant execute on function public.call_edge(text, jsonb) to service_role;

select cron.schedule('channel-sync', '15 */6 * * *', $$ select public.call_edge('channel-sync') $$);
