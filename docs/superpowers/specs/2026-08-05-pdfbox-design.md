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

**"Imagem" = PNG e JPG/JPEG** (WebP aceito como entrada). Na saída de imagem o usuário escolhe PNG ou JPG.

| De → Para | Pipeline | Observação |
|---|---|---|
| PDF → Imagem | pdf.js renderiza página → canvas → PNG/JPG | Todas as páginas ou seleção; salva na galeria (MediaStore) |
| PDF → Word (.docx) | pdf.js `getTextContent` + extração de imagens → lib `docx` | Texto + imagens; layout complexo (colunas/tabelas) degrada — limitação aceita |
| Imagem → PDF | pdf-lib embute a imagem em página | Múltiplas imagens = múltiplas páginas em 1 PDF |
| Imagem → Word (.docx) | **OCR Tesseract.js** offline → texto editável → lib `docx` | traineddata `por`+`eng` empacotados no APK (~+15MB) |
| Word (.docx) → PDF | mammoth (.docx→HTML) → render offscreen → html2canvas → pdf-lib | Visual fiel; texto do PDF não selecionável (páginas viram imagem) |
| Word (.docx) → Imagem | mesmo pipeline, cada página → PNG/JPG | Salva na galeria |
| HTML → PDF / Imagem | render do .html em iframe offscreen sandboxed → html2canvas → pdf-lib ou PNG/JPG | HTML local (arquivo); recursos externos não carregam (offline) |
| Excel (.xlsx) → PDF / Imagem | SheetJS lê a planilha → tabela HTML → mesmo pipeline de render | Uma aba por página; fórmulas viram valor calculado salvo |

- Escopo: só `.docx` e `.xlsx` (não suporta `.doc`/`.xls` legados)
- Todas as libs empacotadas no bundle (zero CDN/rede)

### 2b. Compressão (offline)

| Alvo | Pipeline | Modos |
|---|---|---|
| Comprimir PDF | **Leve**: re-save com pdf-lib (object streams, mantém texto selecionável). **Forte**: pdf.js re-renderiza páginas → JPEG com qualidade escolhida → pdf-lib remonta (reduz muito, perde texto selecionável) | Leve / Média / Forte |
| Comprimir Imagem (PNG/JPG) | `browser-image-compression` (web worker, offline): redução de dimensão e/ou re-encode com qualidade; saída PNG ou JPG (escolha do usuário) | Leve / Média / Forte |

- UI mostra tamanho antes → depois do resultado antes de salvar

### 2c. Juntar PDFs

- 2+ PDFs → 1 PDF único (ex.: 3 páginas + 5 páginas = 8 páginas)
- pdf-lib `copyPages`: preserva conteúdo original sem re-render
- Usuário adiciona os arquivos e reordena a sequência antes de juntar

### 2d. Dividir PDF

- Seleciona página(s) num grid de miniaturas (pdf.js) → gera **2 PDFs**: um com as páginas selecionadas, outro com as restantes (ex.: 10 páginas, separa a 5 → PDF de 1 página + PDF de 9)
- pdf-lib `copyPages`, sem re-render

### 2e. Remover páginas

- Seleciona no grid de miniaturas **quais páginas MANTER** → gera 1 PDF só com elas (as demais saem)
- Mesmo grid/pipeline do Dividir, saída única

### 2f. Digitalizar (câmera → PDF)

- `@capacitor/camera`: tira 1+ fotos em sequência → cada foto vira uma página → 1 PDF
- Preview com opção de refazer/remover foto antes de gerar
- **Filtros por foto antes de gerar o PDF** (canvas pixel manipulation, offline):
  - **Original** — do jeito que está
  - **P&B Digitalização** — grayscale + contraste alto + threshold suave (aparência de scanner)
  - **Escala de cinza** — grayscale simples
  - **Realce** — aumento de contraste/brilho e saturação leve (documento colorido mais legível)
- Preview do filtro aplicado em tempo real; filtro escolhido por foto (não global)
- v1 sem detecção automática de borda/perspectiva (foto entra como está)

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

- Home: grid de ações — conversões (PDF/Word/Imagem/HTML/Excel), Comprimir PDF, Comprimir Imagem, Juntar PDFs, Dividir PDF, Remover páginas, Digitalizar — + botão "Abrir PDF" (viewer)
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

- `.doc`/`.xls` legados, PPTX, edição de PDF, senha/criptografia, iOS, Play Store
- PDF→Excel e PDF→HTML (extração de tabela/estrutura offline não é confiável)
- Detecção automática de borda no scan (avaliar em v2)
