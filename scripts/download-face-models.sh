#!/usr/bin/env bash
# Downloads face-api.js model weights into public/models so the Next.js
# server bundle can load them at runtime. Idempotent — only downloads
# files that are missing. Runs as a postinstall hook.
set -euo pipefail

# Skip on environments that explicitly opt out (e.g. CI-only lint runs)
if [[ "${SKIP_FACE_MODELS:-0}" == "1" ]]; then
  echo "[face-models] SKIP_FACE_MODELS=1, skipping download"
  exit 0
fi

MODELS_DIR="${MODELS_DIR:-public/models}"
BASE_URL="https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model"

# Lightweight stack: detector + landmarks + 128-d descriptor. ~7 MB total.
# vladmandic/face-api ships these as single .bin files (no shards).
FILES=(
  "tiny_face_detector_model-weights_manifest.json"
  "tiny_face_detector_model.bin"
  "face_landmark_68_model-weights_manifest.json"
  "face_landmark_68_model.bin"
  "face_recognition_model-weights_manifest.json"
  "face_recognition_model.bin"
)

mkdir -p "$MODELS_DIR"

# curl is on Vercel build images and most dev machines. Fall back gracefully
# if the box has no curl — postinstall must never fail the install.
if ! command -v curl >/dev/null 2>&1; then
  echo "[face-models] curl not found; skipping download. Run again later or fetch manually." >&2
  exit 0
fi

missing=0
for f in "${FILES[@]}"; do
  out="$MODELS_DIR/$f"
  if [[ -s "$out" ]]; then
    continue
  fi
  missing=$((missing + 1))
  echo "[face-models] Downloading $f"
  if ! curl -fL --retry 3 --retry-delay 2 -sS -o "$out" "$BASE_URL/$f"; then
    echo "[face-models] Failed to download $f — face detection may not work until this is fixed." >&2
    rm -f "$out"
    # Don't fail install; surface in app instead.
    exit 0
  fi
done

if [[ "$missing" -eq 0 ]]; then
  echo "[face-models] All models present in $MODELS_DIR"
else
  echo "[face-models] Downloaded $missing file(s) to $MODELS_DIR"
fi
