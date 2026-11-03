-- A channel row is now a network: one brand with its YouTube channel and its Blotato accounts. YouTube is optional.
-- network_name is the name you chose; title keeps following YouTube's channel title.
alter table public.channels add column if not exists network_name text;

alter table public.publish_queue drop constraint if exists publish_queue_platform_check;
alter table public.publish_queue add constraint publish_queue_platform_check
  check (platform in ('youtube', 'tiktok', 'instagram', 'twitter', 'facebook'));
