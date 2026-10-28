-- Keyword engine v2: absolute per-keyword metrics (work in global exploration, no corpus needed)
-- and related keywords.

alter table public.keyword_snapshots
  add column if not exists views_per_day numeric,        -- median views/day of the page-1 videos
  add column if not exists volume_index int,             -- 0-100, log scale of views_per_day
  add column if not exists difficulty int,               -- 0-100, how hard page 1 is for a small channel
  add column if not exists kw_score int,                 -- 0-100 overall opportunity
  add column if not exists median_subs_top bigint,       -- median subscribers of channels on page 1
  add column if not exists big_share numeric,            -- share of page-1 videos from channels > 100k subs
  add column if not exists title_match_share numeric,    -- share of page-1 titles containing the exact keyword
  add column if not exists fresh_share numeric,          -- share of page-1 videos published in the last 6 months
  add column if not exists results_total bigint;         -- YouTube's totalResults estimate

alter table public.video_keywords add column if not exists rank int;

create table if not exists public.keyword_related (
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  term text not null,
  source text not null,        -- autocomplete | az | question | tag
  rank int,                    -- position in suggestions, or tag frequency for 'tag'
  captured_on date not null default current_date,
  primary key (keyword_id, term, source)
);
alter table public.keyword_related enable row level security;
create policy app_users_all on public.keyword_related for all to authenticated
  using (public.is_app_user()) with check (public.is_app_user());

-- Latest metrics per keyword (one row per keyword)
create or replace view public.v_keyword_metrics with (security_invoker = true) as
select distinct on (k.id)
  k.id as keyword_id, k.niche_id, n.slug as niche_slug, n.is_explore, k.market, k.term, k.source, k.first_seen,
  s.captured_on, s.views_per_day, s.volume_index, s.difficulty, s.kw_score, s.median_subs_top, s.big_share,
  s.title_match_share, s.fresh_share, s.results_total, s.outlier_count, s.yt_autocomplete_rank,
  s.google_autocomplete_rank, s.trends_interest, s.trends_avg_7d, s.trends_avg_30d
from public.keywords k
join public.niches n on n.id = k.niche_id
join public.keyword_snapshots s on s.keyword_id = k.id and s.difficulty is not null
order by k.id, s.captured_on desc;
