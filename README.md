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

GitHub Pages: **Settings → Pages → Source: GitHub Actions**. Pages on a *private* repo needs a paid
GitHub plan; on the free plan make the repo public (no secrets live in the code) or host `web/` elsewhere.

### 2. Google OAuth client
In the OAuth client (type *Web application*), add this **Authorized redirect URI**:

    https://pojvaicmeighnpxaixwa.supabase.co/functions/v1/google-oauth

Then add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Supabase **Edge Function secrets** too
(Supabase → Edge Functions → Secrets). The consent screen must be **In production**, otherwise
Google expires the connection after 7 days.

### 3. Supabase Auth
Supabase → Authentication → URL Configuration: set **Site URL** to your dashboard URL
(e.g. `https://<user>.github.io/youtube-control/`) and add it to **Redirect URLs**.
Only emails in the `app_users` table can see data.

### 4. First run
GitHub → Actions → **Research** → *Run workflow*, then **Channel stats**, then **Google Trends**.

## Jobs

| Workflow | Schedule (UTC) | Does |
|---|---|---|
| `research.yml` | daily 06:00 | YouTube search per seed term and market, autocomplete, outliers, competitors |
| `trends.yml` | daily 07:30 | Google Trends (YouTube Search) interest and momentum, rising queries |
| `channel-stats.yml` | every 6 h | Public stats for all channels; analytics, search terms, traffic for connected ones |
| `hourly.yml` | hourly | Blotato sync, alerts |

Quota: each niche has a daily YouTube API budget (Settings). One search costs about 102 units;
the project cap is 9,500 of Google's 10,000 daily units.

## Studio (video editor)

Flow: **Studio → script page** (one line = one scene, optional `[footage words]` at the end of a line) →
**Create scenes** → **Editor** (live preview, clip per scene, captions, hook, music, sound effects) → **Render final video**.

| Part | Where |
|---|---|
| Scenes + stock clip search | `studio` edge function (Pixabay) |
| Voice + word timings | `prepare.yml` → `collectors/prepare_job.py` (Edge TTS) |
| Preview | `web/editor.bundle.js` (Remotion Player), built from `editor-src/` + `video/` |
| Final MP4 | `video.yml` → `render/render.mjs` (Remotion), uploaded to the private `renders` bucket |

After changing `web/`, `editor-src/` or `video/`, run `./sync-root.sh` (GitHub Pages serves the repo root).

Secrets:

| Where | Secret | Value |
|---|---|---|
| Supabase Edge Function secrets | `GITHUB_TOKEN` | Fine-grained token: this repo only, **Actions: Read and write** |
| Supabase Edge Function secrets | `GITHUB_REPO` | `arifabdelilah1-crypto/youtube-control` |
| Supabase Edge Function secrets | `PIXABAY_API_KEY` | Free key from pixabay.com/api/docs (clip search in the editor) |
| GitHub repo secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Used by the voice and render workflows |

Music: Settings → Music library (upload MP3s by mood; YouTube Audio Library tracks are the safest).
Sound effects in `web/sfx/` are synthesized (no license needed). Fonts in `web/fonts/` are SIL Open Font License.

The older one-click renderer (MoneyPrinterTurbo, `render.yml`) still works for past jobs.

## Not built yet
- Blotato sync adapter (`collectors/blotato_sync.py`): port the request/field mapping from the Réseau DE sync.
- Write actions from the dashboard: edit titles/tags/thumbnails, reply to comments.
- Script pack generation from ideas.
