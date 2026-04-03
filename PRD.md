# NorthVault — Product Requirements Document

**Version:** 1.0
**Date:** 2026-04-03
**Owner:** Clark Maine / Yen Maine
**Status:** Phase 1 In Progress

---

## 1. What is NorthVault

NorthVault is a private, invite-only Digital Asset Management (DAM) system for two related businesses:

- **Nature's Storehouse** — natural grocery and wellness retail store
- **Adirondack Fragrance Farm (ADK)** — specialty fragrance and apothecary brand

Internal use only. ~5 staff users. Not publicly accessible. No self-signup.

---

## 2. Goals

- One centralized place for all photos, videos, documents, and creative files
- Fast search and filtering by business entity, type, tag, and date
- Secure, role-based access (Admin vs Viewer)
- No duplicate files (SHA-256 deduplication)
- Works from any browser, no desktop app required
- Free/low-cost infra (Supabase free tier / $10/mo Pro upgrade when needed)

---

## 3. Users

| User | Role | Business |
|------|------|----------|
| Clark Maine | Admin | Both |
| Yen Maine | Admin | Both |
| ~3 staff | Viewer | One or both |

---

## 4. Phase 1 — MVP

### 4.1 Authentication

- **Supabase Auth** with PKCE flow via `@supabase/ssr`
- **Invite-only**: No public signup. Admin invites users via email.
- **Invite flow**: Admin sends invite → user receives email → clicks link → `/auth/callback` verifies `token_hash` with `verifyOtp({type:'invite'})` → redirects to `/auth/set-password`
- **Password reset flow**: User clicks "Forgot password" → enters email → receives reset email → clicks link → `/auth/callback` verifies with `verifyOtp({type:'recovery'})` → redirects to `/auth/set-password`
- **Set-password page**: Reads existing session from cookie, calls `updateUser({password})` — does NOT re-verify token
- Sessions persisted via SSR cookies (Next.js middleware refreshes tokens)
- `NEXT_PUBLIC_SITE_URL` must be set to production URL for correct email link generation

### 4.2 Asset Upload & Storage

- Drag-and-drop zone (react-dropzone) + click-to-browse
- Bulk upload: multiple files at once
- Supported types: JPG, PNG, GIF, WebP, HEIC, SVG, MP4, MOV, AVI, MKV, WebM, PDF, DOCX, XLSX, PPTX, TXT, CSV, PSD, AI, EPS, INDD, ZIP, and any other file
- Max file size: 500MB per file
- Files stored in Supabase Storage bucket `northvault-assets` (private, signed URLs)
- **Deduplication**: SHA-256 hash computed client-side (Web Crypto API) before upload. If hash already exists in DB → upload skipped, user sees "Duplicate of: [filename]" with link to existing asset
- Upload progress shown per file with status badges (Pending / Hashing / Checking / Uploading / Done / Duplicate / Error)

### 4.3 Asset Metadata

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `file_name` | TEXT | Display name |
| `original_filename` | TEXT | Original upload name |
| `storage_path` | TEXT | Supabase Storage path |
| `storage_url` | TEXT | Signed URL (1-year cache) |
| `file_size` | BIGINT | Bytes |
| `mime_type` | TEXT | MIME type |
| `content_type` | TEXT | `image` / `video` / `pdf` / `document` / `adobe` / `other` |
| `sha256_hash` | TEXT UNIQUE | Deduplication key |
| `business` | TEXT | `natures` / `adk` / `both` |
| `tags` | TEXT[] | User-defined tags |
| `notes` | TEXT | Free-text notes |
| `thumbnail_path` | TEXT | Future: generated preview |
| `uploaded_by` | UUID | Auth user FK |
| `created_at` | TIMESTAMPTZ | Upload timestamp |
| `original_created_at` | TIMESTAMPTZ | File modification time from OS |

### 4.4 Asset Browser & Search

- Grid view (thumbnails, responsive 2–5 cols) + List view (table)
- **Search**: full-text on filename and notes
- **Filters**:
  - Content type pills (Image / Video / PDF / Document / Adobe / Other) — multi-select
  - Business entity dropdown (All / Nature's Storehouse / ADK Fragrance / Both)
  - Date range (from / to)
  - Tags (filter by one or more)
- **Sort**: newest, oldest, name A-Z, name Z-A, largest, smallest
- **Bulk select**: checkbox per card, select-all in list view
  - Download all selected (sequential signed URL downloads)
  - Apply tag to all selected

### 4.5 Asset Preview & Detail Panel

- Slide-in panel from right (fixed overlay)
- **Image**: full-res `<img>` via signed URL
- **Video**: `<video>` player with controls
- **PDF**: `<iframe>` embedded
- **Other** (document, adobe, zip): icon + MIME type + download button
- Panel allows editing: tags (add/remove), notes, business assignment
- Download button triggers signed URL download with original filename
- Admin-only: Delete button (with confirmation dialog)

### 4.6 Tagging

- Tags stored as `text[]` array on asset record
- Add tags during upload (comma-separated input)
- Add/remove tags in detail panel (Enter to add)
- Bulk tag: apply a tag to all selected assets in library
- Future (Phase 2): tag autocomplete from existing tags, tag suggestions

### 4.7 User Management (Admin)

- `/admin` page — admin-only (redirects viewer to `/library`)
- Invite form: email + role (Viewer / Admin) → calls `/api/admin/invite`
- User list table with role dropdown per user
- Admin cannot change their own role via the table

### 4.8 Roles & Permissions

| Action | Admin | Viewer |
|--------|-------|--------|
| Browse & search assets | Yes | Yes |
| Upload assets | Yes | Yes |
| Download assets | Yes | Yes |
| Edit tags / notes / business | Yes | Yes |
| Delete any asset | Yes | No |
| Invite users | Yes | No |
| Change user roles | Yes | No |
| View admin page | Yes | No |

---

## 5. Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16+ (App Router, TypeScript) |
| Auth | Supabase Auth (PKCE, email invites, SSR cookies) |
| Database | Supabase Postgres — schema `northvault` |
| Storage | Supabase Storage — bucket `northvault-assets` |
| Styling | Tailwind CSS v4 |
| Drag-drop | react-dropzone |
| Icons | Inline SVG / emoji (no icon library dependency) |
| Deployment | Vercel (serverless, edge) |

---

## 6. Database Schema

```
northvault (schema)
├── profiles          — user profiles with roles (id, email, name, role, business, created_at)
├── assets            — all uploaded files (see §4.3)
├── collections       — reserved for Phase 2 groupings
└── collection_assets — reserved for Phase 2 many-to-many join
```

Row Level Security (RLS) enabled on all tables.

**Policies:**
- `assets`: authenticated users can SELECT/INSERT/UPDATE/DELETE
- `profiles`: authenticated users can SELECT/INSERT/UPDATE

**Trigger:** `northvault.handle_new_user()` — fires AFTER INSERT on `auth.users`, creates profile row with role from `raw_user_meta_data.role` (defaults to `viewer`).

---

## 7. Auth Email Templates (Supabase Dashboard)

Configure custom email templates in Supabase Dashboard → Authentication → Email Templates:

- **Invite**: Subject "You've been invited to NorthVault", dark header, white card body, single CTA "Set Your Password"
- **Reset**: Subject "Reset your NorthVault password", same style, CTA "Reset Password"

Templates should use `{{ .ConfirmationURL }}` which Supabase populates with the correct `token_hash` link.

---

## 8. Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `NEXT_PUBLIC_SITE_URL` | Production URL (for auth email links) |

---

## 9. File Structure

```
src/
├── app/
│   ├── admin/           — Admin panel (invite users, manage roles)
│   ├── api/admin/       — API routes: invite, patch user role
│   ├── auth/
│   │   ├── callback/    — OTP verification route
│   │   ├── error/       — Auth error display
│   │   ├── login/       — Login + forgot password
│   │   └── set-password/ — Password creation after invite/reset
│   ├── library/         — Asset browser (main page)
│   ├── upload/          — File upload page
│   └── layout.tsx       — Root layout
├── components/
│   ├── assets/
│   │   ├── AssetCard.tsx    — Grid card with thumbnail
│   │   └── AssetDetail.tsx  — Slide-in detail/edit panel
│   └── layout/
│       └── AppShell.tsx     — Nav header + page wrapper
├── lib/
│   ├── supabase/
│   │   ├── client.ts    — Browser Supabase client
│   │   └── server.ts    — Server + service role clients
│   └── utils/
│       ├── fileHash.ts  — SHA-256 + duplicate check
│       └── fileType.ts  — MIME → content type classifier
├── proxy.ts             — Next.js middleware (auth guard + cookie refresh)
└── types/
    └── index.ts         — Shared TypeScript types
```

---

## 10. Phase 2 — Future (Design Notes Only, Not Built)

### 10.1 Social Media Auto-Save
- Instagram Basic Display API or Facebook Graph API webhook
- When a post is published, webhook fires → server downloads media → uploads to NorthVault as new asset with tags `["instagram"]` or `["facebook"]`, business set from account mapping
- Requires OAuth token storage per social account

### 10.2 Canva Apps SDK Integration
- Publish a Canva App that connects to NorthVault
- Users browse NorthVault library from inside Canva and insert assets directly into designs
- Requires Canva developer account + signed Canva App submission
- Auth: Canva SDK passes user context; NorthVault validates against its own user list

### 10.3 Version History
- Track asset revisions (upload new version of same logical asset)
- Keep previous versions accessible and downloadable

### 10.4 Collections
- Named groups of assets (e.g., "Spring 2025 Campaign", "Product Catalog")
- Share collections as a view-only link (no auth required for link viewers)

### 10.5 AI Tagging
- Auto-suggest tags based on image content (e.g., AWS Rekognition or Supabase AI)
- Apply suggested tags with one click during upload

---

## 11. Non-Goals (Phase 1)

- No public-facing gallery
- No self-signup
- No sharing links
- No video transcoding or thumbnail generation
- No real-time collaboration
- No mobile app

---

## 12. Success Criteria (Phase 1)

- Clark and Yen can log in and upload assets
- Uploading the same file twice is blocked with "Duplicate" message
- Assets are searchable by name, type, business, and tag
- Images show thumbnails inline
- Admins can invite new users
- Build passes `npm run build` with zero TypeScript errors
- Deployed and accessible at production Vercel URL
