-- Pinterest & sites: our WordPress sites, each linked to a Pinterest account and board (through Blotato) and to a network
-- (the voice and language of its videos). Every day the sites function picks one published article per site, makes its recipe
-- video (supabase/functions/recipe), and the video job puts the video in the article and pins it (render/site.mjs).
-- The WordPress application password lives in Vault (never in a table): site_set_wp_password / site_wp_password.

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null unique check (base_url ~ '^https://[^/\s]+$'),
  language text not null default 'de',
  wp_user text,
  wp_ok boolean,                      -- the last connection test
  wp_checked_at timestamptz,
  channel_id uuid references public.channels(id) on delete set null,   -- the network the videos are made for (voice, language)
  pinterest_account_id text,          -- Blotato account id
  pinterest_account_name text,
  pinterest_board_id text,
  pinterest_board_name text,
  daily boolean not null default false,
  ai_model text not null default 'claude-sonnet-5-5',
  look text not null default 'clean',
  embed boolean not null default true,    -- put the video in the article
  pin boolean not null default true,      -- pin it on Pinterest
  last_daily_on date,
  synced_at timestamptz,
  articles_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.site_articles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  wp_id bigint not null,
  url text not null,
  title text not null,
  published_at timestamptz,
  status text not null default 'new'
    check (status in ('new', 'making', 'review', 'embedding', 'done', 'failed', 'skipped')),
  idea_id uuid references public.ideas(id) on delete set null,
  video_run_id uuid references public.video_runs(id) on delete set null,
  wp_media_id bigint,
  video_url text,
  embedded_at timestamptz,
  blotato_post_id text,
  pin_url text,
  pinned_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, wp_id)
);
create index site_articles_site_status on public.site_articles (site_id, status, published_at desc);
create index site_articles_run on public.site_articles (video_run_id);

alter table public.sites enable row level security;
alter table public.site_articles enable row level security;
create policy app_users_all on public.sites for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy app_users_all on public.site_articles for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create trigger sites_touch before update on public.sites for each row execute function public.touch_updated_at();
create trigger site_articles_touch before update on public.site_articles for each row execute function public.touch_updated_at();

-- the WordPress application password: written by a team member, read only by the server
create or replace function public.site_set_wp_password(p_site uuid, p_password text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_name text := 'wp_app_password_' || p_site; v_id uuid;
begin
  if not public.is_app_user() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.sites where id = p_site) then raise exception 'site not found'; end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then perform vault.create_secret(p_password, v_name, 'WordPress application password');
  else perform vault.update_secret(v_id, p_password); end if;
end $$;
revoke all on function public.site_set_wp_password(uuid, text) from public, anon;
grant execute on function public.site_set_wp_password(uuid, text) to authenticated;

create or replace function public.site_wp_password(p_site uuid) returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'wp_app_password_' || p_site;
$$;
revoke all on function public.site_wp_password(uuid) from public, anon, authenticated;
grant execute on function public.site_wp_password(uuid) to service_role;

create or replace function public.site_has_wp_password(p_site uuid) returns boolean
language sql security definer set search_path = public, vault as $$
  select public.is_app_user() and exists (select 1 from vault.secrets where name = 'wp_app_password_' || p_site);
$$;
grant execute on function public.site_has_wp_password(uuid) to authenticated;
