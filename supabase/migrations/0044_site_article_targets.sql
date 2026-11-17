-- Pinterest & sites: where one article's video goes, chosen when it's made by hand (null: the site's own settings).
-- {pin, tiktok, youtube, embed}: youtube posts it in the network's next free YouTube slot.
alter table public.site_articles add column if not exists targets jsonb;
