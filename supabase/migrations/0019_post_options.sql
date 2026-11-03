-- Choices made for one post, like its visibility, on top of the network's settings.
alter table public.publish_queue add column if not exists options jsonb not null default '{}'::jsonb;
