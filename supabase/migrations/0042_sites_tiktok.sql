-- Pinterest & sites: a site's daily video can also go to a TikTok account (through Blotato), with a call to action at the end of
-- its caption (a product "link in bio"). isYourBrand: the account promotes our own product (TikTok's content disclosure).
alter table public.sites add column if not exists tiktok_account_id text, add column if not exists tiktok_account_name text,
  add column if not exists tiktok_cta text, add column if not exists tiktok_your_brand boolean not null default true;
alter table public.site_articles add column if not exists tiktok_post_id text, add column if not exists tiktok_url text,
  add column if not exists tiktok_at timestamptz;
