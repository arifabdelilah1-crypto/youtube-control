-- Facebook Pages connected directly with Meta (no Blotato). One row per Page the signed-in Facebook profile manages.
-- The Page's access token is kept in Vault; the dashboard only ever sees the name, picture and linked Instagram account.
create table if not exists public.meta_pages (
  page_id text primary key,
  name text not null,
  picture_url text,
  category text,
  ig_user_id text,
  ig_username text,
  vault_secret_id uuid,
  connected_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.meta_pages enable row level security;
drop policy if exists app_users_all on public.meta_pages;
create policy app_users_read on public.meta_pages for select to authenticated using (public.is_app_user());
-- read-only for the dashboard, and without the token's vault id
revoke all on public.meta_pages from anon, authenticated;
grant select (page_id, name, picture_url, category, ig_user_id, ig_username, connected_by, updated_at) on public.meta_pages to authenticated;

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
    connected_by = excluded.connected_by, updated_at = now();
end;
$$;

create or replace function public.get_meta_page_token(p_page_id text)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select d.decrypted_secret from public.meta_pages p join vault.decrypted_secrets d on d.id = p.vault_secret_id where p.page_id = p_page_id;
$$;

revoke all on function public.store_meta_page(text, text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.get_meta_page_token(text) from public, anon, authenticated;
