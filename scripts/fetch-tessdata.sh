#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../public/tessdata"
# Mantém os .traineddata DESCOMPRIMIDOS: o aapt do Android descompacta e RENOMEIA
# qualquer asset .gz dentro do APK (ex.: por.traineddata.gz -> por.traineddata),
# então servir gzip:true no tesseract.js causa 404 e trava o OCR em 0% pra sempre.
for lang in por eng; do
  [ -f "$lang.traineddata" ] && continue
  curl -fLO "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$lang.traineddata"
done
