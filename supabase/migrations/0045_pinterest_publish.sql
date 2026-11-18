-- Pinterest as a network destination: video pins go out through Blotato (account + board in publish_schedules.targets).
alter table public.publish_queue drop constraint if exists publish_queue_platform_check;
alter table public.publish_queue add constraint publish_queue_platform_check
  check (platform in ('youtube', 'tiktok', 'instagram', 'twitter', 'facebook', 'pinterest'));
