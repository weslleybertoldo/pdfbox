import type { PdfDoc } from "./pdfRender";
import {
  buildText,
  findMatches,
  normalizeForSearch,
  type Normalized,
  type Piece,
} from "./textSearch";

/**
 * Índice de texto por página pra busca no viewer. Os items vêm do MESMO
 * `getTextContent()` (parâmetros default) que o `renderTextLayer` usa — o
 * pdf.js é determinístico, então `pieces[i]` ↔ `textDivs[i]` do text layer
 * (1:1 por índice, inclusive items vazios, que não entram no DOM). É com esse
 * casamento que o viewer transforma uma ocorrência em Ranges sobre os spans.
 * Cache por documento (WeakMap) — o índice de uma página é montado uma vez.
 */
export interface PageIndex {
  page: number;
  text: string;
  pieces: Piece[];
  norm: Normalized;
}

export interface SearchMatch {
  page: number;
  start: number;
  end: number;
}

const cache = new WeakMap<PdfDoc, Map<number, Promise<PageIndex>>>();

export function getPageIndex(doc: PdfDoc, page: number): Promise<PageIndex> {
  let pages = cache.get(doc);
  if (!pages) {
    pages = new Map();
    cache.set(doc, pages);
  }
  let p = pages.get(page);
  if (!p) {
    p = (async () => {
      const pg = await doc.getPage(page);
      const tc = await pg.getTextContent();
      const parts = tc.items.map((it) =>
        "str" in it ? { text: it.str, sepAfter: it.hasEOL } : { text: "" },
      );
      const { text, pieces } = buildText(parts);
      return { page, text, pieces, norm: normalizeForSearch(text) };
    })();
    pages.set(page, p);
    p.catch(() => pages?.delete(page)); // falha (doc destruído) não fica cacheada
  }
  return p;
}

/**
 * Busca a consulta em todas as páginas, em ordem. `onPage` recebe o índice de
 * cada página pronto (o viewer guarda pra fatiar as ocorrências em spans) e
 * `onProgress` as ocorrências acumuladas até ali (contador ao vivo). Abortar
 * pelo `signal` para no fim da página em curso e rejeita com AbortError.
 */
export async function searchPdf(
  doc: PdfDoc,
  query: string,
  opts: {
    signal?: AbortSignal;
    onPage?: (index: PageIndex) => void;
    onProgress?: (found: SearchMatch[], pagesDone: number, total: number) => void;
  } = {},
): Promise<SearchMatch[]> {
  const found: SearchMatch[] = [];
  const total = doc.numPages;
  for (let page = 1; page <= total; page++) {
    if (opts.signal?.aborted) throw new DOMException("busca cancelada", "AbortError");
    const idx = await getPageIndex(doc, page);
    if (opts.signal?.aborted) throw new DOMException("busca cancelada", "AbortError");
    opts.onPage?.(idx);
    for (const m of findMatches(idx.norm, query)) found.push({ page, ...m });
    opts.onProgress?.(found, page, total);
  }
  return found;
}
