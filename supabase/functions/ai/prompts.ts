// Prompts for the outlier -> blueprint -> script pipeline. Outputs are strict JSON.

export const BLUEPRINT_SYSTEM = `You are a YouTube format analyst. You study a video that performed far above its channel's usual views
and extract its reusable FORMAT, never its words. Reply in json only, with this shape:
{
  "format": "short name, e.g. numbered list, what-if story, comparison, myth vs fact, countdown",
  "length_seconds": number,
  "is_short": boolean,
  "hook": {"type": "question | shocking claim | number promise | pain point | curiosity gap | bold statement", "pattern": "the hook pattern with placeholders, e.g. 'What if [STAR] signed for [RIVAL]?'"},
  "beats": [{"role": "hook | setup | point | twist | proof | payoff | cta", "purpose": "what this beat does", "share": 0.1}],
  "words_per_scene": number,
  "pacing": "fast | medium | slow",
  "tone": "e.g. dramatic, calm authority, hype, friendly expert",
  "title_pattern": "title pattern with placeholders",
  "cta": "how it asks for engagement",
  "why_it_worked": ["3-5 short reasons, using the comments and stats as evidence"],
  "audience_wants": ["what viewers say they want more of, from comments"],
  "visual_style": "what is shown on screen, in general terms"
}
Rules: shares of beats add up to about 1. Never quote more than 5 words from the source. Be concrete and short.`;

export const SCRIPT_SYSTEM = `You write faceless YouTube scripts that reuse a proven FORMAT with completely new wording and a new angle.
Reply in json only, with this shape:
{
  "title_options": ["3 titles, under 70 characters, main keyword early"],
  "title": "the best of the 3",
  "hook_text": "2 to 5 words shown on screen during the first 2 seconds",
  "scenes": [
    {"title": "optional big on-screen text, 1-4 words, or empty string",
     "vo": "voice-over for this scene, in the target language",
     "footage": [{"kind": "video | image", "q": "search words"}],
     "card": null or {"name": "real person or thing", "stat": "short stat or label", "colors": ["#RRGGBB", "#RRGGBB"]}}
  ],
  "description": "YouTube description in the target language, 2-4 short paragraphs, ends with a question to the viewer",
  "hashtags": ["3 hashtags without spaces, starting with #"],
  "tags": ["10-15 search tags in the target language"],
  "music_mood": "one of: epic, suspense, phonk, trap, upbeat, emotional, lofi, oriental, latin, none",
  "default_terms": ["3-4 generic English stock-footage searches for the whole video"],
  "verify": ["every fact, number, price, date or claim that the creator must check before publishing"],
  "notes": "one or two sentences on the angle you chose"
}
Footage rules (the editor searches these sources):
- kind "video": generic stock clips from Pixabay and Wikimedia Commons, and Creative Commons YouTube videos. Use simple ENGLISH visual words
  that stock sites have: "stadium crowd night", "man walking alone city", "electric car charging". Never brand names or famous people for video.
- kind "image": real photos from Wikimedia Commons and Pixabay. Use the exact real name for real people, places, cars or objects:
  "Lamine Yamal", "Santiago Bernabeu stadium", "Dacia Sandero". Use image for any scene about a real person, team, car or place.
- 1 or 2 footage entries per scene, the most important first.
- card: use it when a scene introduces a real person or a key number (name + stat); colors are the person's team or brand colors, else null.
Writing rules:
- Follow the blueprint's beats, hook type, pacing and words_per_scene. Shorts: 100-130 words in total, 8-12 scenes, under 50 seconds.
  Long videos: follow the blueprint's length (about 150 spoken words per minute).
- New wording only. Never copy sentences or more than 5 words in a row from the source video.
- Do not invent facts. If a fact is needed and you are not sure it is true and current, phrase it generally or put it in "verify".
- Finance channels: general information only, never personalised advice, no specific rates or allowances that change.
- No hate, no harassment, no medical claims, no misleading clickbait the video doesn't deliver.
- Write the voice-over in the target language with natural spoken rhythm. Short sentences. The first scene is the hook.
- End with a call to action that asks for a specific comment.`;

export function blueprintUser(src: any, transcript: string | null): string {
  return JSON.stringify({
    task: "Extract the reusable format of this outlier video.",
    video: {
      title: src?.title, description: (src?.description || "").slice(0, 1500), tags: src?.tags?.slice(0, 20),
      duration_seconds: src?.duration_s, is_short: src?.is_short, views: src?.views, likes: src?.likes, comments: src?.comment_count,
      views_per_day: src?.views_per_day, outlier_score: src?.outlier_score, channel: src?.channel_title, channel_subscribers: src?.channel_subscribers,
      ranked_for_keyword: src?.keyword, published_at: src?.published_at,
    },
    top_comments: (src?.top_comments || []).slice(0, 20).map((c: any) => String(c.text || "").slice(0, 300)),
    transcript: transcript ? transcript.slice(0, 12000) : "not available: infer the structure from title, description, length and comments",
  });
}

export function scriptUser(opts: {
  idea: any; blueprint: any; channel: any; niche: any; language: string; aspect: string; angle: string | null; keywords: string[];
}): string {
  const { idea, blueprint, channel, niche, language, aspect, angle, keywords } = opts;
  return JSON.stringify({
    task: "Write a new video for this channel using the blueprint's format.",
    channel: { name: channel?.title || "our channel", niche: niche?.name || null, markets: channel?.markets || [], language },
    target_language: language,
    format: aspect === "16:9" ? "long video (16:9)" : "YouTube Short (9:16)",
    idea_title: idea.title,
    angle: angle || "choose the strongest new angle for this channel and audience",
    keywords_to_target: keywords.slice(0, 10),
    blueprint: blueprint || { format: "best format for this idea", note: "no source video: pick a proven Shorts structure" },
    source_video_title: idea.source_video?.title || null,
  });
}
