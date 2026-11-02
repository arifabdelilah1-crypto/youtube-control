# YouTube Control

Multi-channel YouTube research and control dashboard: keyword scores, outliers, trends,
competitors, idea pipeline, and per-channel analytics for every channel you connect.

## What runs where

| Part | Where | Cost |
|---|---|---|
| Database, login, secure functions | Supabase project `youtube-control` (eu-central-1) | Free tier |
| Scheduled jobs (`collectors/`) | GitHub Actions (`.github/workflows/`) | Free |
| Dashboard (`web/`) | GitHub Pages | Free |
| Publishing | Blotato | Your plan |

Already live in Supabase: schema (`supabase/migrations/`), starter Football niche with 12 seed terms,
the Football Fantasy channel, and two edge functions (`keyword-lookup`, `google-oauth`).

## Setup checklist

### 1. GitHub repo
Create a repo named `youtube-control`, push this folder, then add these secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Where to find it |
|---|---|
| `SUPABASE_URL` | `https://pojvaicmeighnpxaixwa.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → `service_role` (secret) |
| `YOUTUBE_API_KEY` | Google Cloud → Credentials → your API key |
| `GOOGLE_CLIENT_ID` | Google Cloud → Credentials → OAuth client |
| `GOOGLE_CLIENT_SECRET` | same OAuth client |
| `BLOTATO_API_KEY` | Blotato → Settings → API |

GitHub Pages: **Settings → Pages → Deploy from a branch: `main`, folder `/` (root)**. The dashboard lives in `web/`;
`./sync-root.sh` copies it to the root that Pages serves. (`.github/disabled/pages.yml` deploys `web/` directly
instead; it needs Pages set to *GitHub Actions* and moving the file into `.github/workflows/`.) Pages on a *private*
repo needs a paid GitHub plan; on the free plan keep the repo public (no secrets live in the code).

### 2. Google OAuth client
In the OAuth client (type *Web application*), add this **Authorized redirect URI**:

    https://pojvaicmeighnpxaixwa.supabase.co/functions/v1/google-oauth

Then add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Supabase **Edge Function secrets** too
(Supabase → Edge Functions → Secrets). The consent screen must be **In production**, otherwise
Google expires the connection after 7 days.

Impressions and CTR: also enable the **YouTube Reporting API** in the same Google Cloud project. The Analytics API
has no impressions metric, so `channel-sync` creates a daily reach report per connected channel
(`channel_reach_basic_a1`) and imports it. First numbers arrive about 2 days after the first sync, then daily,
about 2 days behind. Views, likes and comments are live at every **Refresh now**.

### 3. Supabase Auth
Supabase → Authentication → URL Configuration: set **Site URL** to your dashboard URL
(e.g. `https://<user>.github.io/youtube-control/`) and add it to **Redirect URLs**.
Only emails in the `app_users` table can see data.

### 4. First run
GitHub → Actions → **Research (YouTube search + autocomplete)** → *Run workflow*, then **Google Trends**.
Channel stats need nothing: Supabase runs them.

## Jobs

| Job | Schedule (UTC) | Does |
|---|---|---|
| `.github/workflows/research.yml` | daily 06:00 | YouTube search per seed term and market, autocomplete, outliers, competitors |
| `.github/workflows/trends.yml` | daily 07:30 | Google Trends (YouTube Search) interest and momentum, rising queries |
| Channel stats (Supabase pg_cron → `channel-sync`) | every 6 h, and **Refresh now** | Public stats; analytics, search terms, traffic and impressions for connected channels |
| `.github/disabled/hourly.yml` | off | Blotato sync + alerts. Move it into `.github/workflows/` once the Blotato sync is built and `BLOTATO_API_KEY` is set |

`research.yml` needs the GitHub secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `YOUTUBE_API_KEY`;
`trends.yml` only the two Supabase ones.

Quota: each niche has a daily YouTube API budget (Settings). One search costs about 102 units;
the project cap is 9,500 of Google's 10,000 daily units.

## Studio (video editor)

Flow: **Studio → script page** → **Create scenes** → **Editor** (live preview, clip or photo per scene, scene titles,
name/stat cards, captions, hook, music, sound effects) → **Render final video**.

Script formats (mixable):

    What if Lamine Yamal signed for Real Madrid? [football stadium night, crowd cheering]

    TITLE: YAMAL TO MADRID?
    VO: What if Lamine Yamal signed for Real Madrid?
    FOOTAGE: image: Lamine Yamal | video: football stadium night
    CARD: Lamine Yamal | 19 goals | #A50044 #004D98

Only `VO:` is required. `image:` terms search photos (Wikimedia Commons for real people, places and cars, plus Pexels and
Pixabay), `video:` terms search videos (Wikimedia Commons real footage first, e.g. clubs' CC BY videos, then Pexels and
Pixabay). Each scene
also has a **YouTube CC** button: Creative Commons YouTube videos, search only (YouTube doesn't let apps download other
channels' videos), so a pick keeps its credit and asks for the file; 101 API units per search. Photos get a slow
zoom/pan; photos much wider than the frame sit on a blurred copy of themselves instead of being cropped. Wikimedia and
YouTube CC footage needs a credit: the editor shows the lines and adds them to the idea's description when you render.

**AI script** (top of the script page; also **Generate script** on the Ideas board): DeepSeek writes a script in this format,
plus title options, description, tags, an on-screen hook, a music mood and a list of facts to verify. For an idea saved from
an outlier it first studies that video's format (never its words). It also reads the research tables: the keyword's demand
and difficulty, related searches, the titles ranking for it, the niche's outliers and the channel's best videos. Pick a
length (45 s, 60 s or 3 min); a script far under that length is sent back once. **Improve current** rewrites the script on
the page, keeping what works, and **Restore previous script** goes back to the version before the last AI run
(`ideas.ai.previous`).

**Voices:** the list offers Microsoft Edge TTS voices and, in English, French, Spanish and German, ten Supertonic-3
voices (`supertonic-M1` to `supertonic-F5`). Supertonic-3 runs on the GitHub machine: no server and no key. The job
installs it and downloads the model only when a project uses one of its voices, and faster-whisper times the words for
the captions. The weights are OpenRAIL-M: content must be disclosed as machine generated, and a voice must not
impersonate anyone without their consent.

Dashboard: the channel bus at the top ("Working on") sets the channel Research, Ideas and Studio follow; the selected
channel is lit red. Status lamps: red = live/selected, green = ready, amber = in progress, grey = idle. On phones the
navigation moves to bottom tabs and tables turn into cards.

| Part | Where |
|---|---|
| Scenes + footage search | `studio` edge function: `script.ts` (parser), `stock.ts` (Pexels, Pixabay, Wikimedia Commons) |
| AI script | `ai` edge function: `index.ts` (capture, blueprint, script), `prompts.ts` (DeepSeek prompts and lengths) |
| Voice + word timings | `prepare.yml` → `collectors/prepare_job.py`: Edge TTS, or `collectors/supertonic_voice.py` for Supertonic-3 |
| Preview | `web/editor.bundle.js` (Remotion Player), built from `editor-src/` + `video/` |
| Final MP4 | `video.yml` → `render/render.mjs` (Remotion), uploaded to the private `renders` bucket |

After changing `web/`, `editor-src/` or `video/`, run `./sync-root.sh` (GitHub Pages serves the repo root).

Secrets:

| Where | Secret | Value |
|---|---|---|
| Supabase Edge Function secrets | `GITHUB_TOKEN` | Fine-grained token: this repo only, **Actions: Read and write** |
| Supabase Edge Function secrets | `GITHUB_REPO` | `arifabdelilah1-crypto/youtube-control` |
| Supabase Edge Function secrets | `PIXABAY_API_KEY` | Free key from pixabay.com/api/docs (clip search in the editor) |
| Supabase Edge Function secrets | `PEXELS_API_KEY` | Free key from pexels.com/api (clip search; 200 requests an hour, raised for free on request) |
| Supabase Edge Function secrets | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | DeepSeek key for AI script; model is optional (default `deepseek-chat`) |
| GitHub repo secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Used by the voice and render workflows |

Music: Settings → Music library (upload MP3s by mood; YouTube Audio Library tracks are the safest).
Sound effects in `web/sfx/` are synthesized (no license needed). Fonts in `web/fonts/` are SIL Open Font License.

The older one-click renderer (MoneyPrinterTurbo, `render.yml`) still works for past jobs.

## Not built yet
- Blotato sync adapter (`collectors/blotato_sync.py`): port the request/field mapping from the Réseau DE sync.
- Write actions from the dashboard: edit titles/tags/thumbnails, reply to comments.
