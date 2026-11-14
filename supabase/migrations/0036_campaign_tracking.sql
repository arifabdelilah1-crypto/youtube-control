-- Campaigns, Phase 3: where each approved video went, and the money.
-- links: [{platform, url, status, slot_at}] from the publishing queue; submitted_at / paid_at: set by Arif on the campaign page.
alter table public.campaign_posts add column if not exists links jsonb not null default '[]';
alter table public.campaign_posts add column if not exists submitted_at timestamptz;
alter table public.campaign_posts add column if not exists paid_at timestamptz;
create index if not exists campaign_posts_render on public.campaign_posts (render_job_id);
