#!/bin/bash
# Downloads face-api.js model files from jsdelivr CDN
# Called during postinstall to ensure models are available at build time

MODEL_DIR="public/models/face-api"
BASE_URL="https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model"

MODELS=(
  ssd_mobilenetv1_model-weights_manifest.json
  ssd_mobilenetv1_model-shard1
  ssd_mobilenetv1_model-shard2
  face_landmark_68_model-weights_manifest.json
  face_landmark_68_model-shard1
  face_recognition_model-weights_manifest.json
  face_recognition_model-shard1
  face_recognition_model-shard2
)

mkdir -p "$MODEL_DIR"

for f in "${MODELS[@]}"; do
  if [ ! -f "$MODEL_DIR/$f" ]; then
    echo "Downloading $f..."
    curl -sL -o "$MODEL_DIR/$f" "$BASE_URL/$f"
  fi
done

echo "Face-api models ready in $MODEL_DIR"
