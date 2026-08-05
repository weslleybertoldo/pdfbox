# PDFBox — Design

**Data:** 2026-08-05 · **Status:** aprovado pelo Weslley

## Objetivo

App Android (APK, fora da Play Store) para **visualizar PDF** e **converter documentos 100% offline** — sem servidor, sem chamada de rede em nenhuma conversão. Única exceção de rede: o check de atualização (GitHub Releases), igual aos outros apps próprios.

## Identidade

- Nome: **PDFBox**
- appId: `com.bertoldo.pdfbox`
- Repo: `weslleybertoldo/pdfbox` (GitHub, releases com APK anexado)

## Stack

Clone do padrão PhysiqCalc/NutriTrack:

- Capacitor 8 (Android) + Vite + React + TypeScript + Tailwind/shadcn
- Versão exposta via `__APP_VERSION__` (Vite define, lida do `package.json`)
- Sem backend, sem auth, sem banco — estado todo em memória/filesystem local

## Funcionalidades

### 1. Visualizador de PDF
- pdf.js (bundle local, sem CDN)
- Abrir via file picker; paginação, zoom (pinch/botões) e scroll contínuo

### 2. Conversões (matriz completa)

| De → Para | Pipeline | Observação |
|---|---|---|
| PDF → PNG | pdf.js renderiza página → canvas → PNG | Todas as páginas ou seleção; salva na galeria (MediaStore) |
| PDF → Word (.docx) | pdf.js `getTextContent` + extração de imagens → lib `docx` | Texto + imagens; layout complexo (colunas/tabelas) degrada — limitação aceita |
| PNG → PDF | pdf-lib embute a imagem em página | Múltiplas PNGs = múltiplas páginas em 1 PDF |
| PNG → Word (.docx) | **OCR Tesseract.js** offline → texto editável → lib `docx` | traineddata `por`+`eng` empacotados no APK (~+15MB) |
| Word (.docx) → PDF | mammoth (.docx→HTML) → render offscreen → html2canvas → pdf-lib | Visual fiel; texto do PDF não selecionável (páginas viram imagem) |
| Word (.docx) → PNG | mesmo pipeline, cada página → PNG | Salva na galeria |

- Escopo: só `.docx` (não suporta `.doc` legado)
- Todas as libs empacotadas no bundle (zero CDN/rede)

### 2b. Compressão (offline)

| Alvo | Pipeline | Modos |
|---|---|---|
| Comprimir PDF | **Leve**: re-save com pdf-lib (object streams, mantém texto selecionável). **Forte**: pdf.js re-renderiza páginas → JPEG com qualidade escolhida → pdf-lib remonta (reduz muito, perde texto selecionável) | Leve / Média / Forte |
| Comprimir PNG | `browser-image-compression` (web worker, offline): redução de dimensão e/ou re-encode com qualidade; saída PNG ou JPEG (escolha do usuário) | Leve / Média / Forte |

- UI mostra tamanho antes → depois do resultado antes de salvar

### 3. Arquivos
- Entrada: file picker (`<input type="file">` / Capacitor Filesystem)
- Saída: documentos (.pdf/.docx) → `Downloads/`; PNGs → galeria via MediaStore (padrão PhysiqCalc v2.90)
- Share sheet (`@capacitor/share`) após cada conversão

### 4. Update silencioso (padrão skill-wbs-instalacao-silenciosa-app, Caminho A)
- Plugin nativo `ApkInstallerPlugin.java` copiado do PhysiqCalc (trocar package)
- `MainActivity`: `registerPlugin` antes de `super.onCreate`; Manifest: `REQUEST_INSTALL_PACKAGES` + FileProvider; `file_paths.xml` cache-path
- `lib/apkUpdater.ts` com `downloadAndInstall(url, onProgress)`
- **Banner automático no boot** (`UpdateChecker.tsx`): compara `__APP_VERSION__` × `tag_name` da release GitHub; barra "Baixando X%" → "Abrindo instalador..."
- **Rodapé**: `vX.Y.Z` + botão "Verificar atualizações" (RefreshCw girando) → "✓ Versão mais recente" ou botão "Baixar vX.Y.Z" inline
- Releases: tag `vX.Y.Z` + APK assinado anexado no repo `weslleybertoldo/pdfbox`

## UI (uma tela + viewer)

- Home: grid de ações (8 cards: 6 conversões + Comprimir PDF + Comprimir PNG) + botão "Abrir PDF" (viewer)
- Fluxo de conversão: escolher arquivo → opções mínimas (páginas, se aplicável) → progresso → resultado com "Salvar"/"Compartilhar"
- Rodapé fixo na Home com versão + verificar atualizações

## Tratamento de erros

- Arquivo inválido/corrompido → toast claro, sem crash
- OCR sem texto detectável → aviso "nenhum texto encontrado" e opção de embutir como imagem
- Conversões rodam com indicador de progresso; falha → toast + estado resetado (nunca trava)

## Testes

- vitest: funções puras de conversão (comparação de versão, montagem docx, pipeline de páginas) com fixtures pequenas
- Smoke manual no dispositivo via adb: cada uma das 6 conversões + viewer + update check

## Fora de escopo (YAGNI)

- `.doc` legado, XLSX/PPTX, edição de PDF, senha/criptografia, iOS, Play Store
