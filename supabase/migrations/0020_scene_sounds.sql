-- Sound effects placed on a scene, from the library on the VDS: [{id, title, url, duration, volume, at, cut}]
alter table public.project_scenes add column if not exists sounds jsonb not null default '[]'::jsonb;
