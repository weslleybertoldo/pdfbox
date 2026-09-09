/**
 * Destaque das ocorrências da busca via CSS Custom Highlight API
 * (`CSS.highlights` + `::highlight()`, Chromium ≥ 105): pinta Ranges sobre os
 * nós de texto SEM tocar no DOM — nenhum span é quebrado/reenvolvido. Isso
 * importa no text layer do pdf.js: correctSpanWidths/expandHitAreas medem e
 * ajustam os spans, e a seleção nativa depende da estrutura deles. O fundo do
 * destaque segue o transform/escala do span (igual ao ::selection), então
 * fica alinhado aos glifos do canvas em qualquer zoom.
 * Sem suporte (WebView antiga) a busca continua funcionando (contagem e
 * navegação); só não pinta.
 */
export const HL_ALL = "pdf-search";
export const HL_CURRENT = "pdf-search-current";

export const highlightsSupported = (): boolean =>
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";

export function setSearchHighlights(all: Range[], current: Range[]): void {
  if (!highlightsSupported()) return;
  CSS.highlights.set(HL_ALL, new Highlight(...all));
  const cur = new Highlight(...current);
  cur.priority = 1; // pinta por cima do destaque geral
  CSS.highlights.set(HL_CURRENT, cur);
}

export function clearSearchHighlights(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HL_ALL);
  CSS.highlights.delete(HL_CURRENT);
}

/** Range sobre [start, end) de um nó de texto (offsets clampados ao tamanho). */
export function rangeOver(node: Text, start: number, end: number): Range {
  const r = document.createRange();
  const len = node.length;
  r.setStart(node, Math.min(start, len));
  r.setEnd(node, Math.min(end, len));
  return r;
}

/**
 * Rola até o Range: horizontal dentro do `container` (páginas mais largas que
 * a tela com zoom); vertical no container (modo livro: scroll interno) ou no
 * documento (contínuo). O trecho fica a ~40% da altura visível.
 */
export function scrollToRange(
  range: Range,
  container: HTMLElement,
  vertical: "container" | "document",
): boolean {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false; // nó fora do DOM
  const cr = container.getBoundingClientRect();
  if (rect.left < cr.left + 8 || rect.right > cr.right - 8) {
    container.scrollLeft += rect.left - cr.left - (container.clientWidth - rect.width) / 2;
  }
  if (vertical === "container") {
    container.scrollTop += rect.top - cr.top - container.clientHeight * 0.4;
  } else {
    const scroller = document.scrollingElement ?? document.documentElement;
    scroller.scrollTop += rect.top - window.innerHeight * 0.4;
  }
  return true;
}
