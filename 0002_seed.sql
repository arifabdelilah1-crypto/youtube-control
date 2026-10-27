-- Starter data: dashboard owner, Football niche, its seed terms, first channel.
insert into public.app_users (email) values ('abdelilah199818@gmail.com')
on conflict do nothing;

insert into public.niches (name, slug, languages, markets)
values ('Football', 'football', '{en}', '{GLOBAL,US,GB,MA}')
on conflict (slug) do nothing;

insert into public.seed_terms (niche_id, term, kind)
select n.id, t.term, t.kind::public.seed_kind
from public.niches n
cross join (values
  ('what if football', 'format'),
  ('football what if', 'format'),
  ('football story', 'format'),
  ('transfer that never happened', 'format'),
  ('lamine yamal', 'entity'),
  ('kylian mbappe', 'entity'),
  ('erling haaland', 'entity'),
  ('achraf hakimi', 'entity'),
  ('morocco national team', 'entity'),
  ('jude bellingham', 'entity'),
  ('el clasico', 'topic'),
  ('ballon d''or', 'topic')
) as t(term, kind)
where n.slug = 'football'
on conflict (niche_id, term) do nothing;

insert into public.channels (youtube_channel_id, title, handle, niche_id, language, markets)
select 'UCWOu__JctiiD7h4VsABcGIA', 'Football Fantasy', '@Footballfantasy076', n.id, 'en', '{GLOBAL,US,GB,MA}'
from public.niches n where n.slug = 'football'
on conflict (youtube_channel_id) do nothing;
