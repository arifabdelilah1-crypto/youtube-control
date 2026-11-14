-- Campaigns, Phase 2: making the videos and approving them.
-- campaigns.angles: the last brainstorm ({channel_id, items: [{title, hook, idea, brand_moment}], at}).
-- campaigns.files: the brand's files stored on the VDS ([{path, name, size, type, at}]).
-- campaign_posts: one row per video made for a campaign, from "rendering" to "awaiting_approval" (Phase 3 schedules the approved ones).
alter table public.campaigns add column if not exists angles jsonb;
alter table public.campaigns add column if not exists files jsonb not null default '[]';

alter table public.campaign_posts add column if not exists video_run_id uuid references public.video_runs(id) on delete set null;
alter table public.campaign_posts add column if not exists title text;
alter table public.campaign_posts add column if not exists angle text;
alter table public.campaign_posts drop constraint if exists campaign_posts_status_check;
alter table public.campaign_posts add constraint campaign_posts_status_check
  check (status in ('draft', 'rendering', 'failed', 'awaiting_approval', 'approved', 'rejected', 'scheduled', 'live', 'submitted', 'paid'));
create unique index if not exists campaign_posts_clip on public.campaign_posts (clip_id) where clip_id is not null;
