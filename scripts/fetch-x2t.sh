#!/usr/bin/env bash
# Baixa o x2t do ONLYOFFICE compilado pra WebAssembly (build da CryptPad) pra
# public/x2t/ — é o conversor do Word antigo (.doc → .docx), offline no aparelho.
# Roda 1x por versão; x2t.js/x2t.wasm ficam commitados (igual ao tessdata), pra
# o build não depender de rede. Trocar de versão = mudar VERSAO/URL/SHA512.
set -euo pipefail
VERSAO="v9.3.2+4"
URL="https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/download/v9.3.2%2B4/x2t.zip"
SHA512="8fa965d86ef81c8615f2cc7c67eb0da270f88c573d137dcf82bb5b54d7ffacd66adb0e29f16b46a537279fc1c9ddf13ebc2b6e2f491c08cc4f266e6669763af6"
LICENCA="https://raw.githubusercontent.com/cryptpad/onlyoffice-x2t-wasm/main/core/LICENSE.txt"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/x2t"
TMP="$(mktemp -d)"
trap 'rm -rf -- "${TMP:?}"' EXIT
curl -fsSL -o "$TMP/x2t.zip" "$URL"
echo "$SHA512  $TMP/x2t.zip" | sha512sum -c --quiet -
mkdir -p "$DEST"
unzip -o -q "$TMP/x2t.zip" x2t.js x2t.wasm -d "$DEST"
curl -fsSL -o "$DEST/LICENSE-ONLYOFFICE.txt" "$LICENCA"
echo "x2t $VERSAO em $DEST"
