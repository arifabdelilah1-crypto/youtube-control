-- Automated publishing: a posting schedule per channel and a queue of finished renders.
-- Method "youtube" uploads with the channel's own Google connection (status.publishAt for scheduling);
-- method "blotato" sends the video to a Blotato account instead.

create table if not exists public.publish_schedules (
  channel_id uuid primary key references public.channels(id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  enabled boolean not null default false,            -- finished renders are queued automatically
  method text not null default 'youtube' check (method in ('youtube', 'blotato')),
  blotato_account_id text,
  days int[] not null default '{1,2,3,4,5,6,0}',      -- 0 = Sunday ... 6 = Saturday
  times text[] not null default '{18:00}',            -- local "HH:MM" slots
  timezone text not null default 'Europe/Madrid',
  privacy text not null default 'public' check (privacy in ('public', 'unlisted', 'private')),
  notify_subscribers boolean not null default true,
  synthetic_media boolean not null default false,     -- YouTube "altered or synthetic content" label
  category_id text not null default '22',             -- 22 People & Blogs, 2 Autos, 17 Sports, 27 Education, 24 Entertainment
  updated_at timestamptz not null default now()
);

create table if not exists public.publish_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  render_job_id uuid not null unique references public.render_jobs(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  idea_id uuid references public.ideas(id) on delete set null,
  method text not null default 'youtube',
  title text not null,
  description text,
  tags text[] not null default '{}',
  slot_at timestamptz,                                -- null = publish now
  status text not null default 'queued' check (status in ('queued', 'uploading', 'scheduled', 'published', 'failed', 'cancelled')),
  youtube_video_id text,
  blotato_post_id text,
  error text,
  run_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publish_queue_channel_slot on public.publish_queue (channel_id, slot_at);

drop trigger if exists publish_schedules_touch on public.publish_schedules;
create trigger publish_schedules_touch before update on public.publish_schedules for each row execute function public.touch_updated_at();
drop trigger if exists publish_queue_touch on public.publish_queue;
create trigger publish_queue_touch before update on public.publish_queue for each row execute function public.touch_updated_at();

alter table public.publish_schedules enable row level security;
alter table public.publish_queue enable row level security;
create policy app_users_all on public.publish_schedules for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
create policy app_users_all on public.publish_queue for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
