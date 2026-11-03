// Sending a finished video to Blotato (https://help.blotato.com): TikTok, Instagram Reels, X, Facebook Reels and YouTube.
import fs from "node:fs";

const API = "https://backend.blotato.com/v2";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** X has no room for credits in the post itself, and CC BY music and photos need them: they go in a reply. */
function xCredits(description = "") {
  const at = String(description || "").search(/(^|\n)Credits:\n/);
  if (at < 0) return {};
  const posts = [];
  let current = "";
  for (const line of description.slice(at).trim().split("\n")) {
    if (current && (current + "\n" + line).length > 280) { posts.push(current); current = ""; }
    current = (current ? current + "\n" : "") + line.slice(0, 280);
  }
  if (current) posts.push(current);
  return { additionalPosts: posts.map((text) => ({ text, mediaUrls: [] })) };
}

/** The request for one platform. target: the channel's settings for it (publish_schedules.targets). */
export function blotatoPost({ row, target = {}, mediaUrl, coverUrl, scheduledTime }) {
  const isX = row.platform === "twitter";
  // X takes 280 characters: the title, not the description
  const text = isX ? String(row.title || "").slice(0, 280) : String(row.description || row.title || "").slice(0, 2200);
  const shared = { accountId: row.blotato_account_id, content: { platform: row.platform, text, mediaUrls: [mediaUrl], ...(isX ? xCredits(row.description) : {}) } };
  let platformTarget;
  if (row.platform === "tiktok") {
    platformTarget = {
      targetType: "tiktok", privacyLevel: target.privacy || "PUBLIC_TO_EVERYONE", disabledComments: false, disabledDuet: false, disabledStitch: false,
      isBrandedContent: false, isYourBrand: false, isAiGenerated: target.ai !== false,
    };
  } else if (isX) {
    platformTarget = { targetType: "twitter" };
  } else if (row.platform === "facebook") {
    platformTarget = { targetType: "facebook", pageId: target.page_id, mediaType: "reel" };
  } else if (row.platform === "instagram") {
    platformTarget = { targetType: "instagram", mediaType: "reel", shareToFeed: true, ...(coverUrl ? { coverImageUrl: coverUrl } : {}) };
  } else {
    platformTarget = {
      targetType: "youtube", title: String(row.title || "").slice(0, 100), privacyStatus: target.privacy || "public", shouldNotifySubscribers: target.notify !== false,
      containsSyntheticMedia: !!target.synthetic, ...(coverUrl ? { thumbnailUrl: coverUrl } : {}),
    };
  }
  return { post: { ...shared, target: platformTarget }, ...(scheduledTime ? { scheduledTime } : {}) };
}

/** A presigned upload: Blotato keeps its own copy, so a post scheduled weeks ahead doesn't depend on a link that expires. */
export async function uploadToBlotato(key, file, filename, type) {
  const start = await fetch(`${API}/media/uploads`, { method: "POST", headers: { "blotato-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ filename }) });
  const data = await start.json().catch(() => ({}));
  if (!start.ok || !data.presignedUrl || !data.publicUrl) throw new Error(`Blotato upload start ${start.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const body = fs.readFileSync(file);
  for (let attempt = 1; ; attempt++) {
    const put = await fetch(data.presignedUrl, { method: "PUT", headers: { "Content-Type": type, "Content-Length": String(body.length) }, body });
    if (put.ok) return data.publicUrl;
    if (attempt >= 3) throw new Error(`Blotato upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
    await wait(5000 * attempt);
  }
}

export async function createPost(key, request) {
  const r = await fetch(`${API}/posts`, { method: "POST", headers: { "blotato-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Blotato ${r.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data.postSubmissionId || data.id || null;
}

/** Waits for an immediate post. Still processing after that: status stays "uploading" and the Calendar page finishes the check. */
export async function waitForPost(key, id, { tries = 20, every = 15000 } = {}) {
  for (let i = 0; i < tries; i++) {
    await wait(every);
    const r = await fetch(`${API}/posts/${encodeURIComponent(id)}`, { headers: { "blotato-api-key": key } });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.status === "published") return { status: "published", public_url: data.publicUrl || null };
    if (r.ok && data.status === "failed") throw new Error(`Blotato: ${data.errorMessage || "the post failed"}`);
  }
  return { status: "uploading" };
}
