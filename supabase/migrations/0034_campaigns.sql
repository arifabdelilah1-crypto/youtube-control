-- Campaigns: paid "content rewards" campaigns (Whop and similar). Arif pastes the campaign's text or link; DeepSeek turns it
-- into a campaign card (pay, rules, must-include, banned), flags the risk, and ranks the networks that fit it.
-- campaign_posts holds the videos made for a campaign (Phase 2/3: approval, publishing, views and payout).
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  title text not null,
  brand text,
  source_url text,
  source_text text,                      -- what was read (pasted, or fetched from the link)
  card jsonb not null default '{}',      -- the rules DeepSeek read, editable on the page
  rate_per_1k numeric,                   -- USD per 1,000 qualified views
  cap_per_post numeric,                  -- USD, max per post
  budget numeric,                        -- USD, whole campaign
  deadline date,
  platforms text[] not null default '{}',-- youtube | tiktok | instagram | facebook | x
  content_type text not null default 'promo' check (content_type in ('promo', 'clipping', 'assets')),
  risk text not null default 'green' check (risk in ('green', 'orange', 'red')),
  risk_notes text[] not null default '{}',
  matches jsonb,                         -- [{channel_id, score, eligible, reasons[], est_views, est_payout, ...}]
  new_account jsonb,                     -- suggested new account when no network fits
  matched_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  platform text not null default 'youtube',
  idea_id uuid references public.ideas(id) on delete set null,
  clip_id uuid references public.clips(id) on delete set null,
  render_job_id uuid references public.render_jobs(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_approval', 'approved', 'rejected', 'scheduled', 'live', 'submitted', 'paid')),
  checks jsonb,                          -- automatic rule checklist (brand said, hashtags, disclosure...)
  post_url text,
  views bigint not null default 0,
  views_at timestamptz,
  est_payout numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaign_posts_campaign on public.campaign_posts (campaign_id);

alter table public.campaigns enable row level security;
alter table public.campaign_posts enable row level security;
drop policy if exists app_users_all on public.campaigns;
create policy app_users_all on public.campaigns for all to authenticated using (public.is_app_user()) with check (public.is_app_user());
drop policy if exists app_users_all on public.campaign_posts;
create policy app_users_all on public.campaign_posts for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop trigger if exists campaigns_touch on public.campaigns;
create trigger campaigns_touch before update on public.campaigns for each row execute function public.touch_updated_at();
drop trigger if exists campaign_posts_touch on public.campaign_posts;
create trigger campaign_posts_touch before update on public.campaign_posts for each row execute function public.touch_updated_at();
