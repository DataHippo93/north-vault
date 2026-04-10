# PRD: Social Media Creative Import & Performance Tracking

## Overview

Import creative assets (images, videos) from Facebook/Meta Ads, Instagram, and TikTok into NorthVault, and track their performance metrics (impressions, clicks, spend, conversions, CTR, CPM) across platforms. This turns NorthVault from a pure asset store into a creative performance hub.

## Current State (Already Built)

The following infrastructure is already implemented and deployed:

### Database Tables (4 tables in `northvault` schema)

| Table                | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `social_connections` | Encrypted OAuth tokens per platform/account                    |
| `social_creatives`   | Links vault assets to platform creative IDs                    |
| `social_metrics`     | Daily performance snapshots (impressions, clicks, spend, etc.) |
| `social_sync_log`    | Tracks sync history and errors                                 |

### API Routes (Deployed)

| Route                       | Method      | Status                                  |
| --------------------------- | ----------- | --------------------------------------- |
| `/api/social/connect/meta`  | GET         | Built — redirects to Meta OAuth         |
| `/api/social/callback/meta` | GET         | Built — handles OAuth callback          |
| `/api/social/connections`   | GET, DELETE | Built — list/disconnect accounts        |
| `/api/import/social`        | POST        | Built — SSE streaming creative import   |
| `/api/social/metrics/sync`  | POST        | Built — SSE streaming metrics fetch     |
| `/api/social/metrics`       | GET         | Built — query metrics by asset/creative |

### UI Pages (Deployed)

| Page                                   | Status                                       |
| -------------------------------------- | -------------------------------------------- |
| `/admin/social`                        | Built — connection management, sync controls |
| `/admin/social/import`                 | Built — creative import with progress        |
| Asset detail — SocialMetrics component | Built — performance cards + daily table      |

### Library Code

| File                          | Status                                |
| ----------------------------- | ------------------------------------- |
| `src/lib/social/types.ts`     | Built — shared types                  |
| `src/lib/social/meta.ts`      | Built — Meta Marketing API client     |
| `src/lib/social/metrics.ts`   | Built — normalization + upsert        |
| `src/lib/utils/encryption.ts` | Built — AES-256-GCM for token storage |

---

## What's Needed to Go Live with Facebook

### 1. Meta Developer App Setup

**Who:** Admin (Clark)
**Time:** ~30 minutes

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click "Create App" -> choose "Other" use case -> "Business" type
3. Add the **Marketing API** product
4. Under App Settings > Basic:
   - Note the **App ID** and **App Secret**
   - Add `northvault.adkfragrance.com` to App Domains
5. Under Facebook Login > Settings:
   - Add Valid OAuth Redirect URI: `https://northvault.adkfragrance.com/api/social/callback/meta`
6. Under Marketing API > Tools:
   - Generate a test access token to verify the setup works
7. Request **Standard Access** for `ads_read` permission (instant approval for business-owned apps)

### 2. Environment Variables

Add to Vercel (production):

```
META_APP_ID=<from step 1>
META_APP_SECRET=<from step 1>
SOCIAL_ENCRYPTION_KEY=<run: openssl rand -hex 32>
```

### 3. First Connection

1. Go to Admin > Social Media in NorthVault
2. Click "Connect Meta"
3. Authorize with the Facebook account that manages your ads
4. Select the ad account to connect
5. Click "Import Creatives" to pull in ad images/videos
6. Click "Sync Metrics" to pull performance data

---

## Feature Details

### Creative Import Flow

When you click "Import Creatives":

1. **Enumerate** — Cursor-paginates Meta's Ad Creatives API
   - `GET /act_{id}/adcreatives?fields=id,name,image_url,thumbnail_url,video_id,object_story_spec`
   - For videos: fetches source URL via `GET /{video_id}?fields=source`
   - Also fetches ad/campaign linkage for each creative
2. **Process** (concurrent pool of 4) — For each creative:
   - Download media from Meta CDN
   - SHA-256 dedup against existing assets
   - TUS upload to Supabase Storage
   - AI auto-tagging via Claude Haiku (optional)
   - Insert `assets` row + `social_creatives` row
3. **Progress** — Real-time SSE events show file-by-file progress

### Metrics Sync Flow

When you click "Sync Metrics":

1. Fetches all `social_creatives` for the connection
2. Calls Meta Insights API: `GET /act_{id}/insights?level=ad&fields=impressions,clicks,spend,actions&time_increment=1`
3. Normalizes and upserts daily metrics into `social_metrics`
4. Logs sync in `social_sync_log`

### Performance Display

On any asset's detail view, if it has linked social creatives:

- **Summary cards**: Total impressions, clicks, spend ($), avg CTR
- **Daily table**: Date | Impressions | Clicks | Spend | CTR | CPM
- **Platform badge**: Shows which platform (Meta, Instagram, etc.)

---

## Phase 2: Instagram

Instagram shares the Meta OAuth token. The `instagram_basic` scope is already requested.

### Additional Work

1. Create `src/lib/social/instagram.ts` — Instagram Graph API media listing
2. Add Instagram media enumeration to the import flow
3. Instagram Insights API for reach, impressions, saves, shares

### Instagram-Specific Metrics

- Reach, Impressions, Saves, Shares, Profile Visits
- Story-specific: Exits, Replies, Taps Forward/Back
- Reels: Plays, Accounts Reached, Likes, Comments

---

## Phase 3: TikTok

TikTok has a separate OAuth flow and API.

### Additional Work

1. Create `src/lib/social/tiktok.ts` — TikTok Ads API client
2. Add `/api/social/connect/tiktok` and `/api/social/callback/tiktok`
3. TikTok creative enumeration and report fetching

### TikTok-Specific

- Separate OAuth (not Meta)
- Different creative format (vertical video focused)
- Different metrics: Video Views, Profile Visits, Likes, Shares

---

## Alternative: Metricool Integration

If Clark has a Metricool subscription, this could be a simpler path for **metrics aggregation** (not creative import):

### Pros

- Single API for metrics across Facebook, Instagram, TikTok, etc.
- No need for per-platform OAuth
- Already aggregated data

### Cons

- Can't import creative assets (just metrics)
- Adds a third-party dependency
- API access may require a specific plan tier

### Approach

- Use Metricool API for **metrics only**
- Keep the direct Meta OAuth for **creative import** (downloading actual images/videos)
- Best of both worlds: creatives from Meta, aggregated metrics from Metricool

### Investigation Needed

- Does Metricool have a public API?
- What plan tier is needed?
- What data is available (campaign-level? creative-level?)

---

## Data Model

### social_connections

| Column                 | Type        | Notes                         |
| ---------------------- | ----------- | ----------------------------- |
| id                     | uuid PK     |                               |
| platform               | text        | 'meta', 'instagram', 'tiktok' |
| business               | text        | 'natures', 'adk', 'both'      |
| account_id             | text        | Platform ad account ID        |
| account_name           | text        | Human-readable label          |
| access_token_encrypted | bytea       | AES-256-GCM                   |
| token_expires_at       | timestamptz | Long-lived: 60 days for Meta  |
| scopes                 | text[]      |                               |
| connected_by           | uuid FK     |                               |

### social_creatives

| Column                 | Type              | Notes                    |
| ---------------------- | ----------------- | ------------------------ |
| id                     | uuid PK           |                          |
| asset_id               | uuid FK -> assets | The vault asset          |
| connection_id          | uuid FK           | Source account           |
| platform               | text              |                          |
| platform_creative_id   | text              |                          |
| platform_ad_id         | text              |                          |
| platform_campaign_name | text              |                          |
| creative_url           | text              | Link to view on platform |
| creative_metadata      | jsonb             |                          |

### social_metrics

| Column      | Type              | Notes                   |
| ----------- | ----------------- | ----------------------- |
| creative_id | uuid FK           |                         |
| date        | date              |                         |
| impressions | bigint            |                         |
| clicks      | bigint            |                         |
| spend_cents | bigint            | Cents to avoid float    |
| conversions | integer           |                         |
| ctr         | numeric GENERATED | clicks/impressions      |
| cpm_cents   | numeric GENERATED | spend/impressions\*1000 |
| cpc_cents   | numeric GENERATED | spend/clicks            |

---

## Key Design Decisions

- **Spend in cents (bigint)**: Avoids float rounding. Display divides by 100.
- **Generated columns for CTR/CPM/CPC**: Postgres handles the math, always consistent.
- **Encrypted tokens**: AES-256-GCM with env var key. Appropriate for internal tool.
- **No cron initially**: Manual sync via button. Easy to add Vercel Cron later.
- **Shared import pipeline**: Social import reuses the same TUS upload, dedup, and AI tagging pipeline as SharePoint import.

---

## Success Metrics

1. All active ad creatives imported into the vault with correct tags
2. Daily metrics syncing correctly (verified against Meta Ads Manager)
3. Asset detail view shows accurate performance data
4. Token refresh works seamlessly (60-day long-lived tokens)

## Risks

1. **Meta App Review**: `ads_read` with Standard Access should be instant for business-owned apps, but if Meta flags it, could take 2-5 business days
2. **Token Expiry**: Long-lived tokens last 60 days. Need to implement refresh or re-auth notification before expiry
3. **Rate Limits**: Meta Marketing API has rate limits. The import already uses cursor pagination and reasonable batch sizes
4. **Video Download**: Large video creatives may take time to download from Meta CDN. The existing large-file client-side download pattern handles this
