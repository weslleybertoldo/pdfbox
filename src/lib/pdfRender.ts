import * as pdfjs from "pdfjs-dist";
// Asset cru do pdfjs-dist (bundle local, sem CDN). Os polyfills core-js pro
// worker (thread separada) são injetados por CONCATENAÇÃO no build, via
// plugin `pdfWorkerPolyfillPlugin` em vite.config.ts — ver lá o porquê de
// não dar pra usar o `?worker&url` do Vite pra isso (ele descarta o export
// que o pdf.js precisa no fallback "fake worker").
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl; // bundle local, sem CDN

export type PdfDoc = pdfjs.PDFDocumentProxy;

/**
 * Carrega um PDF a partir dos bytes; quem carrega, destrói via destroyPdf.
 * `.slice()` copia pra um ArrayBuffer novo: o pdf.js transfere (detach) o
 * buffer original pro worker, então sem a cópia uma 2ª chamada com os mesmos
 * `bytes` (ex.: usuário tenta comprimir "média" e depois "forte" na mesma
 * tela) quebra com "ArrayBuffer ... already detached".
 */
export const loadPdf = (bytes: Uint8Array): Promise<PdfDoc> =>
  pdfjs.getDocument({ data: bytes.slice() }).promise;

/** Libera worker + caches do documento; chamar sempre que terminar de usar o doc. */
export async function destroyPdf(doc: PdfDoc): Promise<void> {
  await doc.loadingTask.destroy();
}

/** Maior dimensão física permitida por canvas — zoom alto × DPR estoura o
 *  limite de canvas/memória da WebView Android. */
const MAX_CANVAS_DIM = 4096;

/**
 * Renderiza 1 página num canvas na escala dada.
 *
 * `opts.dpr` multiplica só a resolução FÍSICA do canvas (nitidez em telas de
 * alta densidade); o tamanho CSS (style.width/height) fica na escala lógica.
 * Default 1: consumidores que usam o canvas como IMAGEM (pdfToImages,
 * compressPdfStrong, thumbnails) não ganham DPR implícito — mudaria a
 * resolução dos arquivos gerados. O viewer passa window.devicePixelRatio.
 * A escala física total (scale*dpr) é limitada por MAX_CANVAS_DIM.
 */
export async function renderPage(
  doc: PdfDoc,
  pageNum: number,
  scale: number,
  opts?: { dpr?: number },
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale }); // tamanho CSS (lógico)
  const physRatio = Math.min(
    opts?.dpr ?? 1,
    MAX_CANVAS_DIM / Math.max(viewport.width, viewport.height),
  );
  const physViewport =
    physRatio === 1 ? viewport : page.getViewport({ scale: scale * physRatio });
  const canvas = document.createElement("canvas");
  canvas.width = physViewport.width;
  canvas.height = physViewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  // `canvas` (não `canvasContext`) é o param aceito nesta versão do pdf.js;
  // internamente ele deriva o contexto 2D do próprio canvas.
  await page.render({ canvas, viewport: physViewport }).promise;
  return canvas;
}

// ── Seleção estável por arrasto (replica o TextLayerBuilder do viewer oficial
// do pdf.js — web/text_layer_builder.js). Sem isso, arrastar a alça/mouse por
// um VÃO sem texto (entre linhas, margens) faz o browser "pular" a fronteira
// da seleção pro span absoluto que ele considera mais próximo — selecionando
// trechos que o usuário nunca tocou (bug visto no device). O `endOfContent` é
// um div user-select:none no fim do layer que, durante a seleção (classe
// `selecting`), expande pra cobrir a página inteira SOB os spans (z-index 0):
// o ponteiro num vão ancora nele e a seleção para no último texto real.
// CSS correspondente em index.css (.endOfContent / .textLayer.selecting).
// Registro global textLayer→endOfContent: os listeners de documento existem
// uma única vez enquanto houver text layer vivo (a virtualização do viewer
// remove cada layer via cancel()).
const textLayers = new Map<HTMLElement, HTMLElement>();
let selectionAC: AbortController | null = null;

function unregisterTextLayer(div: HTMLElement): void {
  textLayers.delete(div);
  if (textLayers.size === 0) {
    selectionAC?.abort();
    selectionAC = null;
  }
}

/** Volta o endOfContent pro fim do layer e encerra o estado de seleção. */
function resetEndOfContent(end: HTMLElement, layer: HTMLElement): void {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
}

/** Firefox e Chromium ≥ 148 estendem seleção entre spans absolutos direito;
 *  abaixo disso (WebView Android real) precisa do hack do viewer oficial que
 *  move o endOfContent (user-select:text) pra junto da âncora da seleção. */
function detectFirefoxOrModernChromium(layer: HTMLElement): boolean {
  if (getComputedStyle(layer).getPropertyValue("-moz-user-select") === "none") {
    return true; // Firefox
  }
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { brands: { brand: string; version: string }[] };
    }
  ).userAgentData;
  const chromiumVersion = uaData
    ? uaData.brands.find(({ brand }) => brand === "Chromium")?.version
    : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  return !!chromiumVersion && parseInt(chromiumVersion, 10) >= 148;
}

function enableGlobalSelectionListeners(): void {
  if (selectionAC) return;
  selectionAC = new AbortController();
  const { signal } = selectionAC;
  let isPointerDown = false;
  const resetAll = () => textLayers.forEach(resetEndOfContent);
  document.addEventListener("pointerdown", () => {
    isPointerDown = true;
  }, { signal });
  document.addEventListener("pointerup", () => {
    isPointerDown = false;
    resetAll();
  }, { signal });
  window.addEventListener("blur", () => {
    isPointerDown = false;
    resetAll();
  }, { signal });
  document.addEventListener("keyup", () => {
    if (!isPointerDown) resetAll();
  }, { signal });

  let modernSelection: boolean | undefined; // lazy: precisa de um layer no DOM
  let prevRange: Range | undefined;
  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      resetAll();
      return;
    }
    // layers tocados pela seleção entram em "selecting"; os demais resetam
    const active = new Set<HTMLElement>();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const layer of textLayers.keys()) {
        if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
      }
    }
    for (const [layer, end] of textLayers) {
      if (active.has(layer)) layer.classList.add("selecting");
      else resetEndOfContent(end, layer);
    }

    modernSelection ??= detectFirefoxOrModernChromium(
      textLayers.keys().next().value as HTMLElement,
    );
    if (modernSelection) return;
    // Chromium < 148: reposiciona o endOfContent junto à âncora "viva" da
    // seleção (mesma lógica do TextLayerBuilder oficial) pra extensão por
    // arrasto não saltar entre spans
    const range = selection.getRangeAt(0);
    const modifyStart =
      prevRange &&
      (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    if (!modifyStart && range.endOffset === 0) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor?.previousSibling ?? null;
      } while (anchor && !anchor.childNodes.length);
    }
    const parentTextLayer = anchor?.parentElement?.closest<HTMLElement>(".textLayer");
    const endDiv = parentTextLayer ? textLayers.get(parentTextLayer) : undefined;
    if (endDiv && parentTextLayer && anchor?.parentElement) {
      endDiv.style.width = parentTextLayer.style.width;
      endDiv.style.height = parentTextLayer.style.height;
      endDiv.style.userSelect = "text";
      anchor.parentElement.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling);
    }
    prevRange = range.cloneRange();
  }, { signal });
}

type TextContent = Awaited<ReturnType<pdfjs.PDFPageProxy["getTextContent"]>>;

/**
 * Pós-render: ajusta o `--scale-x` de cada span pela largura REAL renderizada.
 *
 * O TextLayer calcula o scaleX medindo o texto num canvas oculto e ASSUME que
 * o DOM renderiza na mesma proporção. Na WebView Android isso quebra: o
 * textZoom (segue a escala de fonte do sistema) e fontes de sistema/tema
 * mudam a largura do texto no DOM mas não a medição no canvas — o span fica
 * mais curto/largo que os glifos pintados e o destaque do ::selection "para
 * no meio da linha" mesmo com a cópia completa (bug visto no device). Medir
 * getBoundingClientRect() depois do layout e reescalar fecha o descompasso,
 * qualquer que seja a causa do desvio. Leituras e escritas em fases separadas
 * (um único layout).
 */
function correctSpanWidths(
  textContent: TextContent,
  divs: HTMLElement[],
  container: HTMLElement,
  viewport: pdfjs.PageViewport,
): void {
  const sideways = viewport.rotation % 180 !== 0; // layer rodado 90/270
  const containerSpan = sideways ? container.offsetHeight : container.offsetWidth;
  if (!containerSpan) return; // fora do DOM/sem layout → nada a medir
  // transform de ancestral (ex.: scale() do pinch em andamento) entra no rect;
  // o fator é uniforme, então dá pra dividir fora usando o próprio container
  const ancestorScale = container.getBoundingClientRect().width / containerSpan;
  if (!(ancestorScale > 0)) return;
  const pageScale = viewport.scale * (viewport.userUnit ?? 1);
  const fixes: [HTMLElement, number][] = [];
  const n = Math.min(textContent.items.length, divs.length); // 1:1 por índice
  for (let i = 0; i < n; i++) {
    const item = textContent.items[i];
    // mesmo predicado do shouldScaleText do TextLayer (1 char não estica)
    if (!("str" in item) || item.str.length <= 1) continue;
    if (textContent.styles[item.fontName]?.vertical) continue;
    const div = divs[i];
    if (div.style.getPropertyValue("--rotate")) continue; // texto em ângulo: AABB não mede largura
    const target = item.width * pageScale; // largura dos glifos no canvas (px CSS)
    if (!(target > 1)) continue;
    const r = div.getBoundingClientRect();
    const w = (sideways ? r.height : r.width) / ancestorScale;
    if (!(w > 0)) continue;
    const ratio = target / w;
    if (Math.abs(ratio - 1) < 0.01) continue; // DOM ≈ medição (browsers desktop)
    const cur = parseFloat(div.style.getPropertyValue("--scale-x")) || 1;
    fixes.push([div, cur * ratio]);
  }
  for (const [div, sx] of fixes) div.style.setProperty("--scale-x", String(sx));
}

/**
 * Pós-render: expande a ÁREA DE HIT de cada span pra cobrir o vão vertical
 * até a linha seguinte.
 *
 * As alças NATIVAS de seleção (Android) fazem hit-test no ponto do dedo e
 * encaixam a fronteira no texto mais próximo — arrastar a alça por um vão
 * entre linhas faz a seleção PULAR de linha (bug visto no device; o
 * endOfContent só governa a extensão via ponteiro/mouse dentro do layer).
 * Cada span recebe um ::after invisível (CSS .hitPad em index.css) com a
 * altura do vão até a próxima linha abaixo que o sobrepõe na horizontal: um
 * ponto no vão passa a resolver pro próprio span (a linha de CIMA),
 * determinístico. O ::after é absolute (fora do fluxo) — o box do span, o
 * alinhamento do ::selection e o --scale-x (v1.1.3) ficam intactos, e sem
 * conteúdo nada entra na cópia. Vãos maiores que 3× a altura do span ficam
 * de fora (título→rodapé etc.: comportamento nativo). Leituras e escritas em
 * fases separadas (um único layout). Chamar DEPOIS de correctSpanWidths (a
 * sobreposição horizontal usa as larguras já corrigidas).
 */
function expandHitAreas(
  divs: HTMLElement[],
  container: HTMLElement,
  viewport: pdfjs.PageViewport,
): void {
  if (viewport.rotation % 180 !== 0) return; // página de lado: "abaixo" ≠ fluxo do texto
  if (!container.offsetWidth) return; // fora do DOM/sem layout
  // transform de ancestral (ex.: scale() do pinch) entra nos rects; o fator é
  // uniforme, então dá pra dividir fora usando o próprio container
  const ancestorScale = container.getBoundingClientRect().width / container.offsetWidth;
  if (!(ancestorScale > 0)) return;
  type Box = { div: HTMLElement; left: number; right: number; top: number; bottom: number };
  const boxes: Box[] = [];
  for (const div of divs) {
    if (!div.textContent || div.getAttribute("role") === "img") continue;
    if (div.style.getPropertyValue("--rotate")) continue; // texto em ângulo: AABB não serve
    const r = div.getBoundingClientRect();
    if (r.width > 0 && r.height > 0)
      boxes.push({ div, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  const byTop = [...boxes].sort((a, b) => a.top - b.top);
  const pads: [HTMLElement, number][] = [];
  for (const b of boxes) {
    const maxPad = (b.bottom - b.top) * 3;
    // busca binária: primeiro box (em ordem de top) que começa abaixo deste
    let lo = 0;
    let hi = byTop.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byTop[mid].top < b.bottom) lo = mid + 1;
      else hi = mid;
    }
    for (let j = lo; j < byTop.length; j++) {
      const o = byTop[j];
      const gap = o.top - b.bottom;
      if (gap > maxPad) break; // linha de baixo longe demais: sem pad
      if (o.right > b.left && o.left < b.right) {
        if (gap >= 1) pads.push([b.div, gap / ancestorScale]);
        break; // menor top que sobrepõe = vão real; não olhar mais fundo
      }
    }
  }
  for (const [div, pad] of pads) {
    div.classList.add("hitPad");
    div.style.setProperty("--hit-pad", `${pad.toFixed(2)}px`);
  }
}

/**
 * Text layer (seleção/cópia de texto): spans transparentes posicionados sobre
 * o canvas da página. `container` deve ser um `.textLayer` (CSS em index.css)
 * absoluto sobre o canvas E JÁ NO DOM (correctSpanWidths mede layout), e
 * `viewport` a MESMA viewport CSS do canvas (escala lógica, SEM
 * devicePixelRatio) — `--scale-factor` com DPR desalinharia o texto.
 * Retorna handle com cancel() pro descarte da virtualização (também remove o
 * layer do registro de seleção global).
 */
export function renderTextLayer(
  page: pdfjs.PDFPageProxy,
  container: HTMLElement,
  viewport: pdfjs.PageViewport,
): { promise: Promise<unknown>; cancel: () => void } {
  container.style.setProperty("--scale-factor", String(viewport.scale));
  container.style.setProperty("--user-unit", String(viewport.userUnit ?? 1));
  let layer: pdfjs.TextLayer | undefined;
  let cancelled = false;
  const promise = (async () => {
    // getTextContent (não streamTextContent): os MESMOS items alimentam o
    // TextLayer e a correção de largura pós-render (items ↔ textDivs 1:1)
    const textContent = await page.getTextContent();
    if (cancelled) return;
    layer = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport });
    await layer.render();
    if (cancelled) return;
    correctSpanWidths(textContent, layer.textDivs, container, viewport);
    expandHitAreas(layer.textDivs, container, viewport);
    // endOfContent DEPOIS dos spans (mesma ordem do TextLayerBuilder oficial)
    const end = document.createElement("div");
    end.className = "endOfContent";
    container.append(end);
    container.addEventListener("mousedown", () => container.classList.add("selecting"));
    textLayers.set(container, end);
    enableGlobalSelectionListeners();
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      layer?.cancel();
      unregisterTextLayer(container);
    },
  };
}

/** Miniaturas (~140px de largura) para o PageGrid. */
export async function renderThumbnails(doc: PdfDoc): Promise<string[]> {
  const thumbs: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const scale = 140 / page.getViewport({ scale: 1 }).width;
    const canvas = await renderPage(doc, p, scale);
    thumbs.push(canvas.toDataURL("image/jpeg", 0.7));
  }
  return thumbs;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob falhou"))), type, quality),
  );
}
