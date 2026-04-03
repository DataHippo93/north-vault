# Northvault — Product Requirements Document

## What is Northvault

Northvault is a private Digital Asset Management (DAM) system for two related businesses:

- **Nature's Storehouse** — natural grocery and wellness retail
- **Adirondack Fragrance Farm (ADK)** — specialty fragrance and apothecary brand

Internal use only. Not publicly accessible.

---

## Phase 1 — MVP (current)

### Auth

- **Supabase Auth** with PKCE flow
- **Email invite flow**: Admin invites users by email → user receives link → redirects to `/auth/callback` → redirects to `/auth/set-password`
- **Password reset flow**: User requests reset → receives link → redirects to `/auth/callback` → redirects to `/auth/set-password`
- Both flows use `token_hash` OTP verification at `/auth/callback`
- Authenticated sessions persisted via SSR cookies (`@supabase/ssr`)

### Asset Upload & Storage

- Drag-and-drop or file picker upload
- Supported file types: JPG, PNG, GIF, WebP, MP4, MOV, PDF, DOCX, XLSX, PPTX, AI, PSD, SVG, ZIP, and more
- Files stored in Supabase Storage bucket `northvault-assets`
- Max file size: 500MB per file
- **Deduplication**: SHA-256 hash computed client-side before upload; if hash already exists in DB, upload is skipped and user sees "Already exists" with a link to the existing asset
- Upload progress tracked per file

### Asset Metadata & Tagging

Each asset record contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `file_name` | TEXT | Display name |
| `original_filename` | TEXT | Original upload name |
| `file_path` | TEXT | Legacy path field |
| `storage_path` | TEXT | Supabase Storage path |
| `storage_url` | TEXT | Signed URL (cached) |
| `file_size` | BIGINT | Size in bytes |
| `mime_type` | TEXT | MIME type |
| `content_type` | TEXT | Classified type (image/video/pdf/document/adobe/other) |
| `sha256_hash` | TEXT | Unique — dedup key |
| `business` | TEXT | `natures` / `adk` / `both` |
| `uploaded_by` | UUID | Auth user reference |
| `created_at` | TIMESTAMPTZ | Upload timestamp |
| `original_created_at` | TIMESTAMPTZ | File modification time |
| `tags` | TEXT[] | Free-text user tags |
| `notes` | TEXT | Free-text notes |
| `thumbnail_path` | TEXT | Future: generated thumbnails |

### Search & Browse

- Full-text search across filename and notes
- Filter by: content type (image/video/pdf/document/adobe/other), business entity, date range, tags
- Grid view with thumbnails and list view with table
- Sort by: date (newest/oldest), name (A-Z/Z-A), size (largest/smallest)
- Bulk select: download all selected, apply tag to all selected

### Asset Preview

- **Image**: inline `<img>` thumbnail via signed URL
- **Video**: inline `<video>` player
- **PDF**: `<iframe>` embedded viewer
- **Other**: file type icon + download button
- Slide-in detail panel with metadata editor, tag manager, notes, business assignment

### Users & Roles

| Role | Permissions |
|------|-------------|
| `admin` | Invite users, delete any asset, change any metadata, change user roles |
| `viewer` | Upload assets, tag own assets, view all assets |

Profiles auto-created on signup via database trigger (`northvault.handle_new_user()`).

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15+ (App Router) |
| Auth | Supabase Auth (PKCE, email invites) |
| Database | Supabase Postgres (schema: `northvault`) |
| Storage | Supabase Storage (`northvault-assets` bucket) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Deployment | Vercel |

---

## Database Schema

```
northvault (schema)
├── profiles          — user profiles with roles
├── assets            — all uploaded files
├── collections       — asset groupings (future)
└── collection_assets — many-to-many join (future)
```

RLS enabled on all tables. Authenticated users can read all assets; write restricted to uploader or admin.

---

## Phase 2 — Future (design considerations)

- **Canva integration** via Canva Apps SDK — browse and insert Northvault assets directly in Canva designs
- **Social media auto-save** — Instagram/Facebook Graph API webhook saves posts automatically as assets
- **SharePoint import** — bulk import from Microsoft SharePoint document libraries
- **Collections** — curated asset groups with sharing links
- **Thumbnail generation** — server-side thumbnail generation for video and documents
- **Version history** — track asset revisions

---

## Key Design Decisions

1. **Schema isolation**: All Northvault tables live in a dedicated `northvault` Postgres schema to avoid collisions with other Supabase projects sharing the same instance.
2. **Client-side hashing**: SHA-256 computed in the browser using Web Crypto API before upload, keeping dedup logic fast and free.
3. **Signed URLs**: Storage objects use signed URLs (not public), ensuring only authenticated users can access files.
4. **PKCE everywhere**: Both invite and reset flows use the `token_hash` OTP path (not deprecated implicit flow) for security.
5. **Service role for invites**: Admin invite endpoint uses service role key server-side to call `auth.admin.inviteUserByEmail()`.
