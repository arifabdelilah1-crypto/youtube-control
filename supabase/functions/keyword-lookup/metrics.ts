// Pure scoring helpers for one keyword's YouTube page 1. No I/O, so they are easy to test.

export type PageVideo = {
  title: string;
  views: number;
  publishedAt: string; // ISO
  channelSubs: number | null; // null when hidden
};

export type KeywordMetrics = {
  views_per_day: number;
  volume_index: number;
  difficulty: number;
  kw_score: number;
  median_subs_top: number | null;
  big_share: number;
  title_match_share: number;
  fresh_share: number;
  outlier_count: number;
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Does the title contain every word of the keyword (any order)? */
export function titleMatches(title: string, term: string): boolean {
  const t = ` ${norm(title)} `;
  return norm(term).split(" ").filter(Boolean).every((w) => t.includes(` ${w} `) || t.includes(` ${w}s `));
}

/**
 * volume_index: log scale of the median views/day of page-1 videos.
 *   ~10 views/day -> 20, 100 -> 40, 1k -> 60, 10k -> 80, 100k+ -> 100.
 * difficulty: how established page 1 is.
 *   50% channel size (median subs: 1k -> 0, 10k -> 25, 100k -> 50, 1M -> 75, 10M -> 100),
 *   30% share of videos from channels over 100k subs,
 *   20% share of titles already targeting the exact keyword.
 * kw_score: geometric mean of volume and ease (100 - difficulty), +5 when page 1 is stale (few recent videos).
 */
export function scorePage(term: string, videos: PageVideo[], now = Date.now()): KeywordMetrics {
  const top = videos.slice(0, 10);
  const day = 864e5;
  const vpd = top.map((v) => v.views / Math.max((now - Date.parse(v.publishedAt)) / day, 1));
  const viewsPerDay = median(vpd) ?? 0;
  const volume = Math.round(clamp(Math.log10(Math.max(viewsPerDay, 1)) * 20));

  const subs = top.map((v) => v.channelSubs).filter((s): s is number => s !== null);
  const medSubs = median(subs);
  const subsScore = medSubs === null ? 50 : clamp((Math.log10(Math.max(medSubs, 1)) - 3) * 25);
  const n = Math.max(top.length, 1);
  const bigShare = top.filter((v) => (v.channelSubs ?? 0) > 100_000).length / n;
  const titleShare = top.filter((v) => titleMatches(v.title, term)).length / n;
  const freshShare = top.filter((v) => now - Date.parse(v.publishedAt) < 182 * day).length / n;
  const difficulty = top.length ? Math.round(clamp(subsScore * 0.5 + bigShare * 30 + titleShare * 20)) : 0;

  // Geometric mean: a keyword needs BOTH demand and room to rank; zero of either gives ~zero.
  const staleBonus = freshShare < 0.3 && volume > 0 ? 5 : 0;
  const score = top.length ? Math.round(clamp(Math.sqrt(volume * (100 - difficulty)) + staleBonus)) : 0;
  const outliers = videos.filter((v) => v.views / Math.max(v.channelSubs ?? 0, 100) >= 3).length;

  return {
    views_per_day: Math.round(viewsPerDay),
    volume_index: volume,
    difficulty,
    kw_score: score,
    median_subs_top: medSubs === null ? null : Math.round(medSubs),
    big_share: Math.round(bigShare * 100) / 100,
    title_match_share: Math.round(titleShare * 100) / 100,
    fresh_share: Math.round(freshShare * 100) / 100,
    outlier_count: outliers,
  };
}

/** Count tags across page-1 videos; returns most frequent first, excluding the keyword itself. */
export function topTags(tagLists: string[][], term: string, limit = 25): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  const self = norm(term);
  for (const tags of tagLists) {
    const seen = new Set<string>();
    for (const raw of tags || []) {
      const t = raw.trim().toLowerCase();
      if (!t || t.length > 60 || norm(t) === self || seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([t, c]) => ({ term: t, count: c }));
}
