# PDFBox

App Android **100% offline** de manipulação de PDF: visualizador, conversões, compressão, organização de páginas e digitalização — tudo processado no dispositivo, sem upload de arquivos para nenhum servidor.

## Funcionalidades

- **Viewer de PDF** com navegação por páginas e zoom.
- **Conversões** (todas offline, no próprio device):
  - PDF ↔ Word (docx)
  - Imagem → PDF / PDF → Imagens
  - HTML → PDF
  - PDF ↔ Excel (xlsx)
- **Compressão**: PDF, imagem e vídeo.
- **Organização de páginas**: juntar (merge), dividir (split) e remover páginas de um PDF.
- **Digitalizar (scan)**: captura via câmera com filtros de imagem (realce de documento) e exportação para PDF.
- **Atualização in-app**: o app verifica a última release no GitHub e oferece baixar/instalar a atualização direto pela UI, sem precisar de loja de apps.

## Stack

- **Capacitor 8** + **Vite** + **React 19** + **TypeScript**
- Processamento offline no cliente:
  - `pdfjs-dist` (renderização de PDF)
  - `pdf-lib` (manipulação de PDF: merge/split/remove/compress)
  - `docx` + `mammoth` (geração/leitura de Word)
  - `xlsx` (SheetJS, Excel)
  - `tesseract.js` (OCR)
  - `browser-image-compression` / `html2canvas` (imagem e HTML)
- Plugins nativos Android (Capacitor, Java):
  - `MediaSaverPlugin` — salvar arquivos gerados na galeria/armazenamento
  - `VideoCompressorPlugin` — compressão de vídeo nativa
  - `ApkInstallerPlugin` — download + instalação do APK de atualização

## Como buildar

```bash
npm install
npm run build
npx cap sync android
```

Build de release do APK (assinado):

```bash
cd android
ANDROID_HOME=/caminho/para/android-sdk JAVA_HOME=/caminho/para/jdk21 \
  ./gradlew :app:assembleRelease
```

O APK final fica em `android/app/build/outputs/apk/release/app-release.apk`.

### Assinatura (keystore)

O build de release exige `android/key.properties` (**não versionado**, listado no
`android/.gitignore`) apontando para um keystore local, por exemplo `~/keystores/pdfbox.keystore`:

```properties
storeFile=/home/USUARIO/keystores/pdfbox.keystore
storePassword=...
keyAlias=...
keyPassword=...
```

Sem esse arquivo, `assembleRelease` gera um APK não assinado.

## Como fazer uma release

1. Bump de versão no `package.json` (ex.: `npm version patch --no-git-tag-version`).
2. Rebuild (`npm run build && npx cap sync android`) e gerar o APK release (comando acima).
3. Publicar a release no GitHub, com o APK como asset:
   ```bash
   gh release create vX.Y.Z android/app/build/outputs/apk/release/app-release.apk#pdfbox-vX.Y.Z.apk \
     --title "PDFBox vX.Y.Z" --notes "..."
   ```
4. O app instalado detecta a nova tag (`vX.Y.Z` > versão atual) via API do GitHub e oferece
   o update in-app (download com barra de progresso + instalador do Android).

## Estrutura de pastas

```
src/
  components/   componentes de UI (viewer, grid de páginas, checagem de update, etc.)
  screens/      telas do app (Home, Convert, Merge, SplitRemove, CompressPdf/Image/Video, Scan, Viewer)
  lib/          lógica: conversões (lib/convert/*), operações de PDF, OCR, updater, arquivos
  types/        tipagens auxiliares
android/        projeto nativo Capacitor (plugins Java, gradle, manifest)
docs/           specs e planos de desenvolvimento
```
