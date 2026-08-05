#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../public/tessdata"
for lang in por eng; do
  [ -f "$lang.traineddata.gz" ] && continue
  curl -fLO "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$lang.traineddata"
  gzip -9 "$lang.traineddata"
done
