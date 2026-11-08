-- The Trending page: Google Trends' "Trending now" list for one country and period, kept 10 minutes
-- so the page and the Trends job don't read Google again for every click. Only the trending function reads it.
create table if not exists public.trend_cache (
  geo text not null,
  hours int not null check (hours in (4, 24, 48, 168)),
  fetched_at timestamptz not null default now(),
  rows jsonb not null default '[]',
  primary key (geo, hours)
);
alter table public.trend_cache enable row level security;
