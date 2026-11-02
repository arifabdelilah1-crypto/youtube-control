// Footage search: Pexels and Pixabay (videos + photos, free for commercial use), Unsplash (photos), Wikimedia Commons (real people, places, cars,
// videos; free licences that need a credit line, kept on each candidate) and YouTube Creative Commons (search only:
// YouTube doesn't let apps download other channels' videos, so those need the file uploaded).
import type { Footage } from "./script.ts";

export type Candidate = {
  type: "video" | "image"; source: string; id: string; url: string; preview: string; thumb: string; duration: number | null;
  width: number; height: number; tags: string; page: string;
  author?: string; license?: string; license_url?: string;
  download_location?: string;  // Unsplash: called when the photo is used in a video
};

export async function pixabay(key: string, q: string, kind: "video" | "image", aspect: string, page = 1): Promise<Candidate[]> {
  if (!key || !q.trim()) return [];
  const params = new URLSearchParams({ key, q: q.slice(0, 100), safesearch: "true", per_page: "20", page: String(page) });
  if (kind === "image") { params.set("image_type", "photo"); if (aspect === "9:16") params.set("orientation", "vertical"); }
  const r = await fetch(`https://pixabay.com/api/${kind === "video" ? "videos/" : ""}?${params}`);
  if (!r.ok) return [];
  const data = await r.json();
  const vertical = aspect === "9:16";
  const hits: Candidate[] = (data.hits || []).map((h: any) => {
    if (kind === "video") {
      const v = h.videos || {};
      const big = v.large?.url ? v.large : v.medium;
      const small = v.tiny?.url ? v.tiny : v.small;
      if (!big?.url) return null;
      return { type: "video", source: "pixabay", id: String(h.id), url: big.url, preview: small?.url || big.url, thumb: v.medium?.thumbnail || v.small?.thumbnail || big.thumbnail || "",
        duration: h.duration ?? null, width: big.width, height: big.height, tags: h.tags || "", page: h.pageURL || "" };
    }
    return { type: "image", source: "pixabay", id: String(h.id), url: h.largeImageURL, preview: h.webformatURL, thumb: h.previewURL, duration: null,
      width: h.imageWidth, height: h.imageHeight, tags: h.tags || "", page: h.pageURL || "", author: h.user || "", license: "Pixabay Content License" };
  }).filter(Boolean);
  // orientation that matches the video first
  return hits.sort((a, b) => Number((b.height > b.width) === vertical) - Number((a.height > a.width) === vertical));
}

const UA = "YouTubeControl/1.0 (https://github.com/arifabdelilah1-crypto/youtube-control)";
const PEXELS_ORIENTATION: Record<string, string> = { "9:16": "portrait", "16:9": "landscape", "1:1": "square" };

/**
 * Pexels: free videos and photos in HD and 4K. Credit isn't required by the licence, but its API terms ask for a link
 * to Pexels and a credit when possible, so candidates carry one. Limit: 200 requests an hour; past that it returns
 * nothing and the other sources carry on.
 */
export async function pexels(key: string, q: string, kind: "video" | "image", aspect: string, page = 1): Promise<Candidate[]> {
  if (!key || !q.trim()) return [];
  const params = new URLSearchParams({ query: q.slice(0, 100), per_page: "20", page: String(page) });
  if (PEXELS_ORIENTATION[aspect]) params.set("orientation", PEXELS_ORIENTATION[aspect]);
  const r = await fetch(`https://api.pexels.com/v1/${kind === "video" ? "videos/" : ""}search?${params}`, { headers: { Authorization: key, "User-Agent": UA } });
  if (!r.ok) return [];
  const data = await r.json();
  const license = { license: "Pexels License", license_url: "https://www.pexels.com/license/" };
  const sized = (original: string, px: number) => `${original.split("?")[0]}?auto=compress&cs=tinysrgb&w=${px}`;
  if (kind === "image") {
    // deno-lint-ignore no-explicit-any
    return (data.photos || []).map((p: any): Candidate | null => {
      if (!p.src?.original || !p.width || !p.height) return null;
      const px = Math.min(p.width, p.width >= p.height ? 1920 : 1280);  // enough for a 1920 px wide or a 1080 px wide frame
      return { type: "image", source: "pexels", id: String(p.id), url: sized(p.src.original, px), preview: sized(p.src.original, 500), thumb: sized(p.src.original, 330), duration: null,
        width: px, height: Math.round(p.height * px / p.width), tags: p.alt || "", page: p.url || "", author: p.photographer || "Unknown author", ...license };
    }).filter((c: Candidate | null): c is Candidate => !!c);
  }
  // deno-lint-ignore no-explicit-any
  const short = (f: any) => Math.min(f.width, f.height);
  // deno-lint-ignore no-explicit-any
  return (data.videos || []).map((v: any): Candidate | null => {
    // deno-lint-ignore no-explicit-any
    const files = (v.video_files || []).filter((f: any) => f.file_type === "video/mp4" && f.link && f.width && f.height).sort((a: any, b: any) => short(a) - short(b));
    // the best file up to 1080p (4K is slow to preview and render, and the video is at most 1080p), and a light one for the preview
    // deno-lint-ignore no-explicit-any
    const best = files.filter((f: any) => short(f) <= 1080).pop() || files[0];
    if (!best) return null;
    // deno-lint-ignore no-explicit-any
    const small = files.find((f: any) => short(f) >= 360) || best;
    const name = String(v.url || "").match(/\/video\/(.+?)-?\d*\/?$/)?.[1]?.replace(/-/g, " ") || "";
    return { type: "video", source: "pexels", id: String(v.id), url: best.link, preview: small.link, thumb: v.image ? sized(v.image, 330) : "", duration: v.duration ?? null,
      width: best.width, height: best.height, tags: name, page: v.url || "", author: v.user?.name || "Unknown author", ...license };
  }).filter((c: Candidate | null): c is Candidate => !!c);
}

const UNSPLASH_ORIENTATION: Record<string, string> = { "9:16": "portrait", "16:9": "landscape", "1:1": "squarish" };

/**
 * Unsplash: free photos. Its API terms ask to use its image URLs directly (kept here, with their ixid), to credit the
 * photographer and Unsplash, and to report each photo used (trackUnsplashDownloads). Limit: 50 requests an hour until
 * Unsplash approves the app; past that it returns nothing and the other sources carry on.
 */
export async function unsplash(key: string, q: string, aspect: string, page = 1): Promise<Candidate[]> {
  if (!key || !q.trim()) return [];
  const params = new URLSearchParams({ query: q.slice(0, 100), per_page: "20", page: String(page) });
  if (UNSPLASH_ORIENTATION[aspect]) params.set("orientation", UNSPLASH_ORIENTATION[aspect]);
  const r = await fetch(`https://api.unsplash.com/search/photos?${params}`, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  if (!r.ok) return [];
  const utm = "utm_source=youtube_control&utm_medium=referral";
  // deno-lint-ignore no-explicit-any
  return ((await r.json()).results || []).map((p: any): Candidate | null => {
    if (!p.urls?.raw || !p.width || !p.height) return null;
    const sized = (px: number) => `${p.urls.raw}${p.urls.raw.includes("?") ? "&" : "?"}w=${px}&fit=max&fm=jpg&q=80`;
    const px = Math.min(p.width, p.width >= p.height ? 1920 : 1280);
    return { type: "image", source: "unsplash", id: String(p.id), url: sized(px), preview: sized(500), thumb: sized(330), duration: null,
      width: px, height: Math.round(p.height * px / p.width), tags: p.alt_description || p.description || "",
      page: p.links?.html ? `${p.links.html}?${utm}` : "", author: p.user?.name || "Unknown author", license: "Unsplash License", license_url: "https://unsplash.com/license",
      download_location: p.links?.download_location || `https://api.unsplash.com/photos/${encodeURIComponent(p.id)}/download` };
  }).filter((c: Candidate | null): c is Candidate => !!c);
}

/** Tells Unsplash which photos a video uses, as its API terms require. Never blocks a render. */
export async function trackUnsplashDownloads(key: string, clips: (Partial<Candidate> | null | undefined)[]): Promise<void> {
  // the clip is editable by the client: the key only ever goes to Unsplash's own API
  const urls = [...new Set(clips.filter((c) => c?.source === "unsplash").map((c) => String(c?.download_location || "")).filter((u) => u.startsWith("https://api.unsplash.com/photos/")))];
  if (!key) return;
  await Promise.allSettled(urls.map((u) => fetch(u, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } })));
}

const text = (html = "") => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

/** Photos from Wikimedia Commons, best match first. Thumbnails are 1280 px (enough for a 1080 px wide frame). */
export async function wikimedia(q: string, page = 1): Promise<Candidate[]> {
  if (!q.trim()) return [];
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    generator: "search", gsrsearch: `${q.slice(0, 100)} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "20", gsroffset: String((page - 1) * 20),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1280",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName",
  });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!r.ok) return [];
  const data = await r.json();
  const pages: any[] = data.query?.pages || [];
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p): Candidate | null => {
    const ii = p.imageinfo?.[0];
    if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || "")) return null;
    const w = ii.thumbwidth || ii.width, h = ii.thumbheight || ii.height;
    if (!w || !h || Math.min(w, h) < 480) return null;
    const original = String(ii.url || "").split("?")[0];
    const url = String(ii.thumburl || original).split("?")[0];
    // commons/a/ab/File.jpg -> commons/thumb/a/ab/File.jpg/330px-File.jpg
    const parts = original.match(/^(.*\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+\.(?:jpe?g|png))$/i);
    const small = (px: number) => (parts && w > px ? `${parts[1]}/thumb/${parts[2]}/${parts[3]}/${px}px-${parts[3]}` : url);
    const meta = ii.extmetadata || {};
    const name = text(meta.ObjectName?.value) || String(p.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    return {
      type: "image", source: "wikimedia", id: String(p.pageid), url, preview: small(500), thumb: small(330), duration: null,
      width: w, height: h, tags: name, page: ii.descriptionurl || "",
      author: text(meta.Artist?.value).slice(0, 120) || "Unknown author", license: text(meta.LicenseShortName?.value) || "see file page", license_url: meta.LicenseUrl?.value || "",
    };
  }).filter((c): c is Candidate => !!c);
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Real footage from Wikimedia Commons (match clips, cars, places; includes videos clubs and brands released under CC BY).
 * Commons' search also matches descriptions loosely, so a result must name a word of the query in its title.
 * Plays from Commons' own WebM copy (up to 1080p), never the original Ogg file.
 */
export async function wikimediaVideos(q: string, page = 1): Promise<Candidate[]> {
  if (!q.trim()) return [];
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    generator: "search", gsrsearch: `${q.slice(0, 100)} filetype:video`, gsrnamespace: "6", gsrlimit: "20", gsroffset: String((page - 1) * 20),
    prop: "videoinfo", viprop: "url|size|mime|derivatives|extmetadata", viurlwidth: "330",
    viextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName",
  });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!r.ok) return [];
  const data = await r.json();
  const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  // deno-lint-ignore no-explicit-any
  const pages: any[] = data.query?.pages || [];
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p): Candidate | null => {
    const vi = p.videoinfo?.[0];
    const meta = vi?.extmetadata || {};
    const name = text(meta.ObjectName?.value) || String(p.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    const title = ` ${fold(`${p.title} ${name}`).replace(/[^a-z0-9]+/g, " ")} `;
    if (!vi || !vi.duration || vi.duration < 2 || (words.length && !words.some((w) => title.includes(` ${w} `)))) return null;
    // deno-lint-ignore no-explicit-any
    const webm = (vi.derivatives || []).filter((d: any) => /^video\/webm/.test(d.type || "") && d.height >= 360 && d.height <= 1080)
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => b.height - a.height || Number(/vp9/.test(b.type)) - Number(/vp9/.test(a.type)));
    const best = webm[0], small = webm[webm.length - 1];
    if (!best) return null;
    const thumb = String(vi.thumburl || "").split("?")[0];
    return {
      type: "video", source: "wikimedia", id: String(p.pageid), url: best.src, preview: small.src, thumb, duration: Number(vi.duration),
      width: best.width, height: best.height, tags: name, page: vi.descriptionurl || "",
      author: text(meta.Artist?.value).slice(0, 120) || "Unknown author", license: text(meta.LicenseShortName?.value) || "see file page", license_url: meta.LicenseUrl?.value || "",
    };
  }).filter((c): c is Candidate => !!c);
}

const isoSeconds = (d = "") => {
  const m = d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0)) : null;
};

/**
 * YouTube videos their owners licensed under Creative Commons (CC BY: reuse allowed with credit). 101 quota units.
 * Search only: there's no file to play, so picking one keeps the credit and asks for the file to be uploaded.
 */
export async function youtubeCC(apiKey: string, q: string): Promise<Candidate[]> {
  if (!apiKey || !q.trim()) return [];
  const search = await fetch(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
    key: apiKey, part: "snippet", type: "video", videoLicense: "creativeCommon", maxResults: "12", q: q.slice(0, 100) })}`);
  if (!search.ok) throw new Error(`YouTube search ${search.status}: ${(await search.text()).slice(0, 200)}`);
  // deno-lint-ignore no-explicit-any
  const ids = ((await search.json()).items || []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const details = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ key: apiKey, part: "snippet,contentDetails,status", id: ids.join(",") })}`);
  if (!details.ok) throw new Error(`YouTube videos ${details.status}`);
  // deno-lint-ignore no-explicit-any
  return ((await details.json()).items || []).filter((v: any) => v.status?.license === "creativeCommon").map((v: any): Candidate => ({
    type: "video", source: "youtube", id: v.id, url: "", preview: "", thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || "",
    duration: isoSeconds(v.contentDetails?.duration), width: 1280, height: 720, tags: v.snippet?.title || "", page: `https://www.youtube.com/watch?v=${v.id}`,
    author: v.snippet?.channelTitle || "Unknown channel", license: "CC BY (YouTube)", license_url: "https://creativecommons.org/licenses/by/3.0/",
  }));
}

export type StockKeys = { pixabay: string; pexels: string; unsplash: string };

/** One from each list in turn, so no source drowns the others. */
function alternate(...lists: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
    for (const l of lists) if (l[i]) out.push(l[i]);
  }
  return out;
}

/** Videos from every source that can play them: Wikimedia (real subjects) first, then Pexels and Pixabay. */
async function videosFor(keys: StockKeys, q: string, aspect: string, page: number): Promise<Candidate[]> {
  const [wiki, pex, pix] = await Promise.all([
    wikimediaVideos(q, page).catch(() => []),
    pexels(keys.pexels, q, "video", aspect, page).catch(() => []),
    pixabay(keys.pixabay, q, "video", aspect, page).catch(() => []),
  ]);
  return [...wiki.slice(0, 6), ...alternate(pex, pix)];
}

/** Every source for one term. "both" mixes videos and photos so each scene gets a choice of either. */
export async function searchStock(keys: StockKeys, q: string, kind: Footage, aspect: string, page = 1): Promise<Candidate[]> {
  if (kind === "video") return videosFor(keys, q, aspect, page);
  const [wiki, pex, uns, pix, videos] = await Promise.all([
    wikimedia(q, page).catch(() => []),
    pexels(keys.pexels, q, "image", aspect, page).catch(() => []),
    unsplash(keys.unsplash, q, aspect, page).catch(() => []),
    pixabay(keys.pixabay, q, "image", aspect, page).catch(() => []),
    kind === "both" ? videosFor(keys, q, aspect, page) : Promise.resolve([]),
  ]);
  const images = [...wiki.slice(0, 8), ...alternate(pex, uns, pix)];
  return kind === "image" ? images : alternate(videos, images);
}
