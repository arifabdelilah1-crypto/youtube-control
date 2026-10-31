// Footage search: Pixabay (videos + photos, no credit needed), Wikimedia Commons (real people, places, cars,
// videos; free licences that need a credit line, kept on each candidate) and YouTube Creative Commons (search only:
// YouTube doesn't let apps download other channels' videos, so those need the file uploaded).
import type { Footage } from "./script.ts";

export type Candidate = {
  type: "video" | "image"; source: string; id: string; url: string; preview: string; thumb: string; duration: number | null;
  width: number; height: number; tags: string; page: string;
  author?: string; license?: string; license_url?: string;
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

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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

/** Videos from every source that can play them: Wikimedia (real subjects) first, then Pixabay. */
async function videosFor(key: string, q: string, aspect: string, page: number): Promise<Candidate[]> {
  const [wiki, pix] = await Promise.all([wikimediaVideos(q, page).catch(() => []), pixabay(key, q, "video", aspect, page)]);
  return [...wiki.slice(0, 6), ...pix];
}

/** Every source for one term. "both" mixes videos and photos so each scene gets a choice of either. */
export async function searchStock(key: string, q: string, kind: Footage, aspect: string, page = 1): Promise<Candidate[]> {
  if (kind === "video") return videosFor(key, q, aspect, page);
  const [wiki, photos, videos] = await Promise.all([
    wikimedia(q, page).catch(() => []),
    pixabay(key, q, "image", aspect, page),
    kind === "both" ? videosFor(key, q, aspect, page) : Promise.resolve([]),
  ]);
  const images = [...wiki.slice(0, 8), ...photos];
  if (kind === "image") return images;
  // both: alternate video / photo
  const out: Candidate[] = [];
  for (let i = 0; i < Math.max(videos.length, images.length); i++) {
    if (videos[i]) out.push(videos[i]);
    if (images[i]) out.push(images[i]);
  }
  return out;
}
