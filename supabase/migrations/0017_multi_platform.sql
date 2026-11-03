-- One render can go to several platforms, each with its own row in the queue.
-- publish_schedules.targets: [{platform, method, account_id, privacy, ai}]; null keeps the older single-method behaviour.
alter table public.publish_schedules add column if not exists targets jsonb;

alter table public.publish_queue add column if not exists platform text not null default 'youtube'
  check (platform in ('youtube', 'tiktok', 'instagram'));
alter table public.publish_queue add column if not exists blotato_account_id text;
alter table public.publish_queue add column if not exists public_url text;

alter table public.publish_queue drop constraint if exists publish_queue_render_job_id_key;
alter table public.publish_queue add constraint publish_queue_job_platform_key unique (render_job_id, platform);
create index if not exists publish_queue_slot on public.publish_queue (slot_at);
