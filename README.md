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

## Studio (video rendering)

Studio renders videos with [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) inside the
`render.yml` GitHub Actions workflow (free on public repos; ~2,000 min/month on private ones).
Flow: dashboard → `render` edge function → GitHub workflow → MP4 uploaded to the private `renders` bucket.

Extra setup:

| Where | Secret | Value |
|---|---|---|
| GitHub repo secrets | `PEXELS_API_KEY` | Free key from pexels.com/api (stock footage) |
| GitHub repo secrets | `PIXABAY_API_KEY` | Optional, pixabay.com/api/docs |
| Supabase Edge Function secrets | `GITHUB_TOKEN` | Fine-grained token: this repo only, permission **Actions: Read and write** |
| Supabase Edge Function secrets | `GITHUB_REPO` | `owner/repo`, e.g. `arifabdelilah1-crypto/youtube-control` |

Voices are Microsoft Edge TTS (free). Videos over 48 MB are re-encoded to fit the free Storage limit.

## Not built yet
- Blotato sync adapter (`collectors/blotato_sync.py`): port the request/field mapping from the Réseau DE sync.
- Write actions from the dashboard: edit titles/tags/thumbnails, reply to comments.
- Script pack generation from ideas.
