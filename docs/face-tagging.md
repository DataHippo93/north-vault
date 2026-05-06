# Face tagging — operations guide

NorthVault uses **face-api.js** for on-device face detection and 128-d
descriptor extraction. No external API. No approval gate. Models ship with
the build (~7 MB).

## How it works

1. Upload an image → row inserted with `faces_scanned=false`.
2. **Cron** (`/api/cron/face-scan`, every 5 min via `vercel.json`) and
   the **admin "Scan all" button** (`/api/admin/face-scan-all`) pick up
   unscanned images.
3. For each image:
   - Download via signed URL.
   - face-api.js detects faces → 128-d descriptors.
   - Each descriptor → `match_face()` cosine search vs existing persons.
   - Match (>0.78 cosine sim) → attach to existing person.
   - No match → create a new person.
   - Crops saved to `storage/northvault-assets/faces/<asset_id>/<face_id>.jpg`.
4. On success: `faces_scanned=true`, `face_scan_error=null`.
5. On failure: `face_scan_error=<msg>`, **scanned stays false** so the
   asset is retried on the next run.

## Setup checklist

| Step | What | Where |
|---|---|---|
| 1 | Models on disk | Run `npm run face-models:download` (postinstall does this automatically). Files land in `public/models/` |
| 2 | Vercel build picks them up | `public/` is bundled into the deployment. No extra config |
| 3 | `CRON_SECRET` env var | Already in BWS as `CRON_SECRET`. Add to Vercel env if not set |
| 4 | Smoke test | `npm run face-models:test` — runs the engine against a sample image |
| 5 | Trigger first scan | Admin → "Scan all faces" button (or wait for the 5-min cron) |

## Inspecting state

Admin SQL views — query them in Supabase SQL editor:

```sql
SELECT * FROM northvault.v_face_scan_status;
SELECT * FROM northvault.v_face_scan_errors LIMIT 20;
```

Status view shows `scanned / pending / with_errors / attempted_last_hour`.

## When something goes wrong

**Symptom: People page is empty after a scan**
- Check `northvault.v_face_scan_errors` for recurring messages.
- Common: `Face models not installed on server` — postinstall didn't run.
  Fix: redeploy or run `npm run face-models:download` and restart.

**Symptom: Same person appears as multiple entries in /people**
- The 0.78 cosine threshold may be too strict for this dataset.
- Tunable in `src/lib/faceapi/matching.ts` (`SIMILARITY_THRESHOLD`).
- Lower → more clustering (risk: merges different people).
- Higher → fewer false merges (risk: same person split).

**Symptom: Cron is too slow**
- `BATCH_SIZE` in `src/app/api/cron/face-scan/route.ts` controls per-run
  throughput. ~25 fits comfortably in Vercel's 300s timeout. Bump cron
  frequency in `vercel.json` instead of batch size if you need to backfill
  faster.

## Why we left Azure Face API

Microsoft put Face Identification (the `faceId` + `recognition_04` features
the old code relied on) behind Limited Access. New customers — including
this workspace — get HTTP 403 `UnsupportedFeature`. The detection-only
mode still works without approval, but you lose the embedding side, which
is what makes person clustering possible.

face-api.js gives us real, stable 128-d embeddings, no per-call rate
limit, no approval gate, and it's free.

The Azure code is gone but `AZURE_FACE_ENDPOINT` / `AZURE_FACE_KEY` env
vars are still tolerated by `env.ts` as optional, so nothing breaks if
they linger in BWS / Vercel env.
