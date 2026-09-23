# PDFBox — Word fiel (ver e converter com a formatação do arquivo) — Design

**Data:** 2026-09-23 · **Status:** desenho aprovado pelo Weslley ("aprovado") · **Entrega 1 de 2**

## Problema

O viewer de Word e as conversões Word → PDF / Word → Imagem usam o **mammoth** (`docxToHtml`), que por
projeto só extrai o conteúdo semântico: descarta cabeçalho e rodapé (onde fica o logo), alinhamento, recuo,
fontes, tamanho de página e margens. Caso real: o **Ofício 014/2026 da FABd** (logo no cabeçalho; rodapé
com linha + logo + endereço + CNPJ; data à direita; parágrafo justificado com recuo; assinatura
centralizada) aparece só como texto alinhado à esquerda, na tela e no PDF convertido.

Pedido do Weslley: *"Preciso visualizar do jeito correto e na hora de converter precisa converter
corretamente com a formatação e elementos do arquivo"*.

## Decisões do Weslley (23/09/2026)

- **Porta B, 2 entregas:** (1) tela + conversão — **esta spec**; (2) Editar mantendo a formatação — spec
  própria depois.
- **PDF convertido = imagem da página** (texto não selecionável, como hoje).
- **Editar continua como hoje na entrega 1** (mammoth → contentEditable → `htmlToDocx`).
- **Caminho:** biblioteca `docx-preview` + fontes equivalentes às do Word embutidas no app.
  Descartados: LibreOffice em WASM (app cresce dezenas de MB) e ajustar o mammoth (não lê cabeçalho,
  rodapé nem alinhamento).

## Prova de conceito (feita antes do desenho)

`docx-preview` 0.4.1 renderizou o ofício real com cabeçalho/logo, rodapé, data à direita, parágrafo
justificado com recuo e assinatura centralizada — com as **mesmas quebras de linha** do PDF original dele,
desde que (a) as fontes do Word existam (`Times New Roman` → Tinos) e (b) o texto use largura exata de
glifo. No Chromium do Linux o hinting arredonda a largura de cada letra: a linha do rodapé ("____ logo
____") passou 1 px do limite e quebrou. Com `--font-render-hinting=none` (largura exata, igual ao
Android) ficou em uma linha, igual ao original. **O harness roda sempre com essa flag.**

## Escopo da entrega 1

### 1. Tela (viewer, modo leitura)

- Render com `docx-preview`: páginas no tamanho do documento (`pgSz`), margens (`pgMar`), cabeçalho e
  rodapé (com imagens), alinhamento, recuos, espaçamentos, fontes, cores, negrito/itálico/sublinhado,
  listas, tabelas e imagens inline.
- Páginas brancas sobre o fundo escuro do app, com espaço entre elas, **encaixadas na largura** da tela
  (zoom 1 = página na largura útil).
- **Zoom:** botões − / + no topo (0,5× a 3× do encaixe), **pinça** e **toque duplo** (alterna 1× ↔ 2×
  no ponto tocado). Reusa a matemática pura de `zoomMath.ts` (`clampGesture`, `focalScroll`).
  Escala comitada via CSS `zoom` (texto re-renderiza nítido); durante a pinça, `transform` provisório.
- **Pesquisa** (barra inferior) continua: mesmo núcleo (`textSearch.ts` + `searchHighlight.ts`) sobre os
  nós de texto das páginas, inclusive cabeçalho/rodapé; navegar rola até a ocorrência.
- **Links do documento:** `http`/`https` abrem no Custom Tab (`openLink.ts`), `mailto`/`tel` pelo intent,
  âncora interna (`#marcador`) rola até o marcador. Qualquer outro esquema é removido.
- **Editar (lápis):** continua o editor atual. Ao entrar em edição o documento aparece como texto
  (mammoth, calculado só nessa hora). Salvar gera o `.docx` editado como hoje e a leitura passa a mostrar
  esse `.docx` salvo, renderizado pelo `docx-preview`. Cancelar volta à leitura fiel do arquivo aberto.
- **Estado do viewer:** o `docxHtml` (mammoth) deixa de ser a leitura. A leitura usa o documento já
  preparado e validado (`docxDoc`); o HTML do mammoth (`editHtml`) só existe durante a edição. Pontos
  que hoje olham `docxHtml` e passam a olhar `docxDoc`: `hasContent`, dependências e nós da pesquisa,
  botão Pesquisar da barra inferior, lápis, bloco de render, cancelar/salvar da edição.
- **Erros:** abrir continua atômico — o `.docx` é preparado e validado (campos de página + parse da
  `docx-preview`) **antes** de trocar o que está na tela; falhou → toast "Não foi possível abrir este
  Word" e o arquivo anterior continua aberto. Na conversão, erro segue o fluxo atual da tela Converter.

### 2. Paginação (tela e conversão usam a MESMA função)

O `docx-preview` só quebra página em quebra explícita (`w:br type=page`, `pageBreakBefore`, troca de
seção). Arquivo exportado pelo Google Docs não tem `lastRenderedPageBreak` → um documento longo vira uma
página gigante. Por isso:

- **Paginador por transbordo:** para cada página cujo conteúdo passa da altura útil, move blocos inteiros
  (parágrafo, tabela) para uma página nova clonada (mesmo tamanho, margens, cabeçalho e rodapé).
- **Altura útil medida no DOM de cada página:** altura da página − início do conteúdo (depois do
  cabeçalho) − (rodapé + margem inferior). Cabeçalho maior que a margem empurra o conteúdo, como no Word.
- **Parágrafo que não cabe:** divide entre linhas (medidas por `Range.getClientRects`), com no mínimo
  2 linhas em cada lado; senão move o parágrafo inteiro. A continuação perde o recuo de 1ª linha; a
  última linha antes do corte continua justificada se o parágrafo for justificado.
- **Tabela que não cabe:** divide entre linhas (`tr`), repetindo a estrutura da tabela (`colgroup`,
  largura, estilos) na página nova.
- **Bloco mais alto que uma página inteira sem ponto de corte:** fica transbordando — a tela mostra a
  página mais alta; a conversão fatia na altura da página como último recurso.
- **Cabeçalho/rodapé das páginas novas:** variante da seção conforme a página — padrão; 1ª página
  diferente (`titlePg`) só na 1ª página da seção; par/ímpar (`evenAndOddHeaders`) pela paridade do número
  da página. Variante que não existir no DOM renderizado vem de uma **sonda**: render do mesmo `.docx` com
  o corpo trocado por 3 parágrafos vazios separados por quebra de página e a mesma `sectPr`. Vale para
  documento de **uma seção** (o caso comum); com várias seções, a página nova repete o cabeçalho e o
  rodapé da página de onde saiu.
- **Número de página:** campos `PAGE` e `NUMPAGES` (simples `w:fldSimple` e complexos
  `w:fldChar`/`w:instrText`) de cabeçalho, rodapé e corpo mostram o número real de cada página e o total.
  Antes do render, o XML recebe um marcador no lugar do resultado do campo; depois da paginação, cada
  página troca o marcador pelo número. (Hoje o `docx-preview` descarta `fldSimple` e mostra o valor salvo
  nos campos complexos — "1" em todas as páginas.)

### 3. Conversão (Word → PDF e Word → Imagem)

- Mesmo render + mesma paginação, num **iframe isolado fora da tela** (`sandbox="allow-same-origin"`,
  sem scripts; só as páginas). O CSS do app não vale dentro do iframe: ele recebe o próprio `@font-face`
  das fontes embutidas e uma CSP `default-src 'none'; img-src data: blob:; style-src 'unsafe-inline';
  font-src 'self' data: blob:`; as fontes carregam no documento do iframe antes de medir.
- Cada página → `html2canvas` (escala 2) → JPEG (PDF) ou PNG/JPG (imagem), **uma página por vez no DOM
  do iframe** durante a captura (o `html2canvas` clona o documento inteiro a cada chamada; com todas as
  páginas no DOM o custo seria quadrático).
- **PDF:** cada página no tamanho do documento (px CSS × 0,75 = pt; A4 = 595 × 842 pt), não mais A4 fixo.
- **Barra de progresso por página** (hoje fica travada em "Convertendo 0%").
- Vale para as três entradas: tela "Word → PDF", tela "Word → Imagem" e as ações do viewer (Funções).

### 4. Fontes embutidas

- `public/fonts/docx/*.woff2`, recortadas para latim + pontuação e símbolos comuns (U+0000–024F,
  02B0–036F, 1E00–1EFF, 2000–22FF, 2500–25FF, FB00–FB06), 4 estilos cada — **~1,4 MB no total**:

  | Nome no Word | Fonte livre (métrica igual) |
  |---|---|
  | Times New Roman | Tinos |
  | Arial, Helvetica | Arimo |
  | Courier New | Cousine |
  | Calibri | Carlito |
  | Cambria | Caladea |
  | Georgia | Gelasio |

- `@font-face` declarado com os **nomes do Word**; licenças OFL em `public/fonts/docx/LICENSES.md`.
- Script reprodutível `scripts/build-docx-fonts.py` (baixa do `google/fonts` num commit fixo, recorta com
  fontTools e gera woff2).
- Antes de medir/paginar: `document.fonts.load` das famílias usadas no arquivo + `document.fonts.ready`.
  Fonte fora da lista cai no padrão do sistema.

### 5. Segurança

O `.docx` é entrada não confiável e a WebView do Capacitor tem a ponte nativa na origem do app.

- `docx-preview` com **`renderAltChunks: false`** — o padrão (`true`) cria `<iframe srcdoc>` com HTML
  vindo do arquivo, **sem sandbox, na origem do app**. Também `renderComments: false`,
  `renderChanges: false`.
- Varredura depois do render: remove `script`/`iframe`/`object`/`embed`, atributos `on*`, `href` fora de
  `http(s)`/`mailto`/`tel`/`#`, e `url()` não embutida em estilo e `<style>` (reusa `stripExternalRefs` /
  `stripCssUrls` do `htmlPipeline`, que passam a ser exportadas).
- Imagens como `data:` (`useBase64URL: true`) — nenhuma requisição de rede.
- Classe própria da lib (`className: "docxv"`): o CSS gerado fica escopado e não vaza para o app. Na
  tela, os `<style>` da lib vão dentro do próprio componente (somem junto com ele, não acumulam no
  `<head>`).

## Arquitetura

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/docx/pageFields.ts` | Marca `PAGE`/`NUMPAGES` no XML (puro; teste em Node com `@xmldom/xmldom`) |
| `src/lib/docx/fonts.ts` | Famílias embutidas, mapa nome do Word → arquivo, preload |
| `src/lib/docx/sanitize.ts` | Varredura de segurança do DOM renderizado |
| `src/lib/docx/render.ts` | `renderDocx(bytes, container, styleContainer)`: campos → docx-preview → sanitização → fontes |
| `src/lib/docx/paginate.ts` | Núcleo puro (onde cortar, a partir de alturas) + camada DOM (mover blocos, dividir parágrafo/tabela, clonar página, sonda de cabeçalho, números de página) |
| `src/lib/convert/docxToPdf.ts` | Reescrito: iframe isolado, render + paginação, captura página a página, progresso, tamanho real |
| `src/lib/convert/htmlPipeline.ts` | `pageImagesToPdf` aceita tamanho por página; exporta os helpers de sanitização |
| `src/components/DocxView.tsx` | Visualização: páginas, encaixe, zoom (botões/pinça/toque duplo), links; expõe a raiz pra pesquisa |
| `src/screens/Viewer.tsx` | Troca o bloco docx pelo `DocxView`; editor mammoth só ao entrar em edição |
| `src/index.css` | `@font-face` das 6 famílias |
| `scripts/build-docx-fonts.py` | Gera as fontes |

`mammoth` continua (editor). `docx-preview` entra com versão **exata** `0.4.1` (API 0.x pode mudar).

## Testes e prova

- **vitest (Node):** `pageFields` (fldSimple, campo complexo em várias runs, NUMPAGES, sem campo =
  inalterado, XML inválido = inalterado); núcleo da paginação (cortes a partir de alturas, mínimo de
  2 linhas, bloco maior que a página); sanitização de `href` por esquema; tamanho px → pt.
- **Harness Playwright mobile** (Pixel 7, Chromium com `--font-render-hinting=none`, app real no
  `vite preview`):
  - ofício real, com asserções objetivas: 1 página; `img` no cabeçalho; no 1º parágrafo do rodapé os
    dois traços e o logo na mesma linha (topo igual ±2 px); data com `text-align: right`; parágrafo do
    corpo `justify` com recuo de 1ª linha > 0; assinatura `center`. Mais o print, que eu comparo com o
    PDF original dele antes do gate;
  - documento longo sem quebras (estilo Google Docs): várias páginas, nenhuma linha cortada,
    cabeçalho/rodapé e número de página certos em todas;
  - tabela longa dividida entre linhas; documento com `titlePg`;
  - zoom (botões, pinça, toque duplo) e pesquisa com destaque;
  - Word → PDF: N páginas no tamanho certo, barra de progresso andando;
  - `.docx` malicioso (altChunk com `<script>`, link `javascript:`): nada executa, link removido;
  - `.docx` corrompido: toast de erro e o arquivo anterior continua na tela;
  - tempo (informativo, harness no PC): ofício < 1 s até a página pronta; documento de 750 parágrafos
    < 3 s até paginar.
- **GATE 1:** APK de teste no aparelho dele + prints conferidos.

## Fora de escopo

- Texto selecionável no PDF (decisão dele).
- Editar mantendo a formatação (entrega 2).
- Paginar seções com colunas (ficam transbordando).
- Redistribuir notas de rodapé entre páginas criadas pelo paginador (ficam na página onde a lib as pôs).
- Formas e caixas de texto flutuantes além do que a `docx-preview` já faz.
- Parada de tabulação personalizada: a tabulação vira um espaço fixo, como a `docx-preview` faz por
  padrão (`experimental: false`). O modo experimental dela recalcula as tabulações 500 ms depois do
  render, mudando o layout depois da paginação.
- Fontes além das 6 famílias.

## Riscos

- `docx-preview` é 0.x → versão exata + harness cobrindo o que usamos.
- A sonda de cabeçalho (`titlePg`/par-ímpar) é a parte mais complexa e o caso mais raro → implementada
  por último, isolada; se ameaçar a entrega, sai desta entrega e o gate diz isso.
- `html2canvas` × CSS da lib (marcadores de lista em pseudo-elemento, tabulações) → harness confere o PDF.
- Documento grande no celular (html2canvas é lento) → uma página por vez + progresso.

## Critério de pronto

- O Ofício 014 aparece no app e sai no PDF igual ao PDF original dele.
- Documento sem quebras salvas → páginas corretas, sem linha cortada, cabeçalho/rodapé e número de
  página em todas.
- vitest + `tsc`/build + oxlint verdes; harness N/N; GATE 1 aprovado por ele no aparelho.
