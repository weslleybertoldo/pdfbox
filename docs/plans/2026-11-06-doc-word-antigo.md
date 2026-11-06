# PDFBox — abrir e converter `.doc` (Word 97-2003) igual ao Word

Status: EM ANDAMENTO · início 06/11/2026 ~18h · worktree `~/projetos/pdfbox-doc-antigo` (branch `feat/doc-word-antigo`, de `origin/main` `2ecce3d` = v1.8.2)
Esteira: `Skill-wbs-local-stg-prod-ate-o-fim` (pedido dele 06/11/2026: até o fim, sem gates) sobre a `skill-wbs-deploy-local-staging-prod-pessoal`.

## Pedido e decisões (palavras dele, 06/11/2026)
- "o app PDFBox não deixa eu selecionar o arquivo word para converter em PDF" — o arquivo era `.doc` (Word antigo).
- Opção **1** = converter o `.doc` dentro do celular, offline. "Preciso que o PDF fique igual o word."
- **Modelo dos testes** = o formulário dele: "Usa como modelo o que te enviei pra fazer os testes" (`2 - FORMULÁRIO FUNDESP - Passagem Aérea 2024.doc`).
- "Isso é só pra esse tipo de arquivo né? O restante continua normal" → sim: só o `.doc` passa pelo conversor; `.docx`, PDF e imagens seguem iguais.
- Licença: o conversor do OnlyOffice é AGPL → **1** = o PDFBox vira AGPL (repo já público, sem licença até hoje).

## Diagnóstico (conferido em `origin/main` `2ecce3d`)
- `src/screens/Convert.tsx:72` (Word → PDF) e `:76` (Word → Imagem): `accept: ".docx"`; `AndroidManifest.xml:37,47` ("Abrir com"/Compartilhar) só registram o MIME do `.docx`; o motor (docx-preview 0.4.1) só lê `.docx`.
- Teste de viabilidade: x2t nativo (OnlyOffice DocumentBuilder v10) `.doc` → `.docx` (formato 65) → `docxToPdf` do app = página quase em branco. O `.docx` põe o formulário num `<w:pict><v:group coordorigin coordsize>` com 26 `v:shape` + `v:textbox` (7 tabelas dentro); o `parseVmlElement` do docx-preview não trata `group` (`default: return null`) e descarta tudo. Brasão do cabeçalho (VML `v:imagedata`) também some; nº da página vai pra esquerda.
- Referência "igual ao Word" = PDF do x2t nativo (`m_nFormatTo` 513), já entregue a ele.

## Arquitetura
1. **Conversor no celular**: x2t do OnlyOffice compilado pra WebAssembly (build da CryptPad `onlyoffice-x2t-wasm` v9.3.2+4, `x2t.zip` 16,7 MB) em `public/x2t/`, carregado SÓ quando o arquivo é `.doc`, num Web Worker: `.doc` → `.docx` em memória → segue o pipeline "Word fiel" de hoje (viewer, Word → PDF, Word → Imagem).
2. **Caixas de texto VML no leitor de Word** (patch do docx-preview 0.4.1 via `patch-package`, só `dist/docx-preview.mjs`): `v:group` (coordorigin/coordsize → pt), `v:shape`/`v:rect` com `v:textbox` e `v:imagedata` viram **HTML** (div absoluta com borda = stroke, fundo = fill, padding = inset; `<img>` pra imagem) — SVG/foreignObject não sai no html2canvas. Posição ancorada no parágrafo (`mso-position-*-relative: text`) ou na página/margem, ajustada pelo app depois do render (`src/lib/docx/vml.ts`).
3. **Entrada do `.doc`**: `isWordFile` (`.doc`/`.docx` por MIME ou extensão) nos seletores de Word → PDF/Imagem, no "Abrir PDF/Word", no ActionsMenu e no `AndroidManifest` (`application/msword`).
4. **Licença**: `LICENSE` AGPL-3.0 na raiz, `"license"` no package.json, aviso de terceiros (x2t/OnlyOffice + CryptPad, fonte e versão) e link "Código aberto (AGPL-3.0)" no rodapé.

## Checklist
- [x] F0 Decisões + plano (este arquivo)
- [x] F1 x2t WASM: baixar, conferir sha512, testar `.doc` → `.docx` no Node com o modelo, worker + `docToDocx()` no app, testes
- [x] F2 VML: patch do docx-preview (group/shape/textbox/imagedata/stroke/fill/inset) + posicionamento no app + framePr do nº de página; testes
- [x] F3 `.doc` aceito em Convert (Word → PDF/Imagem), viewer, ActionsMenu, Abrir com/Compartilhar; testes
- [x] F4 Licença AGPL + avisos + rodapé; versão 1.9.0 (package.json + versionCode 1009000)
- [ ] F5 Prova: modelo lado a lado (app × referência) sem diferença relevante; `.docx` antigos sem regressão (harness Word existente); vitest + lint + build; APK release assinado; emulador abre o `.doc` e converte
- [ ] F6 Produção: PR → squash → release GitHub v1.9.0 (Latest, APK) → AAB na Alpha da Play → memória + relatório

## Andamento (06/11/2026)
- F1: x2t WASM roda no worker clássico `public/x2t/x2t-worker.js`; teste `docToDocx.test.ts` executa o MESMO worker num contexto vm (fixture sintética `word97.doc`). Arquivos do x2t commitados (como o tessdata) via `scripts/fetch-x2t.sh` (sha512).
- F2: patch do docx-preview (`patches/docx-preview+0.4.1.patch`): grupo/caixa/imagem VML → HTML + `lrTb` = texto horizontal (a lib virava vertical). `src/lib/docx/vml.ts` posiciona as camadas (âncora → margem/parágrafo/página) e isola a herança de estilo do parágrafo da âncora. `src/lib/docx/frames.ts`: nº de página em quadro (`framePr xAlign=right`) flutua à direita.
- Achado extra (bug antigo, todo Word/HTML/Excel → PDF): o preflight do Tailwind (`img{display:block}`) quebrava a medida de linha de base do html2canvas e o texto saía ~7 px abaixo. Correção em `src/index.css`. Regressão em 2 `.docx` reais: mesmas páginas, texto no lugar certo (a linha "Re:" do memorando deixou de sair riscada).
- Prova: modelo lado a lado (app × referência) igual; E2E no app compilado (`vite preview`): seletor aceita `.doc`, Word → PDF em 3,2 s, PDF idêntico ao do harness; visualizador abre o `.doc` como `formulario.docx`, 0 erro no console. vitest 212/212, oxlint 0, tsc ok, build ok.

## Critério de pronto
- O PDF que o app gera do modelo bate com a referência (tabelas, caixas, bordas, brasão, nº da página), conferido em imagem lado a lado.
- Nada muda pra `.docx`/PDF/imagem (regressão zero nos harnesses e testes).
