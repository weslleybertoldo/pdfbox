/**
 * Busca de texto do viewer — núcleo PURO (sem DOM, sem pdf.js) compartilhado
 * entre PDF (items do getTextContent) e Word (nós de texto do HTML):
 *
 * - `normalizeForSearch`: minúsculas, sem acento/marcas (NFKD + remoção de
 *   \p{M}; ligaduras viram letras), runs de espaço/quebra colapsados num " ".
 *   Devolve também o MAPA índice-normalizado → índice-original, porque a
 *   normalização muda o tamanho do texto ("ﬁ" → "fi", "é" → "e") e o destaque
 *   precisa dos offsets ORIGINAIS (é neles que o Range do DOM opera).
 * - `buildText`: concatena os trechos (items/nós) num texto único guardando
 *   onde cada trecho começa (peças). Um separador " " opcional após o trecho
 *   (fim de linha do pdf.js, fronteira de bloco no Word) entra no texto mas
 *   NÃO pertence a peça nenhuma — nunca vira destaque.
 * - `findMatches`: ocorrências (não sobrepostas) da consulta normalizada,
 *   já traduzidas pra offsets originais.
 * - `splitMatch`: fatia uma ocorrência nos trechos que ela atravessa (um
 *   Range por trecho — a palavra pode estar quebrada em 2+ spans no PDF).
 *
 * Índices são em code units UTF-16 (os mesmos de `String`, `item.str` e
 * `Range.setStart/End`), de propósito.
 */

export interface Normalized {
  /** texto normalizado (minúsculas, sem marcas, espaços colapsados) */
  norm: string;
  /** map[i] = índice, no texto ORIGINAL, do caractere que gerou norm[i] */
  map: number[];
}

/** Ocorrência em offsets do texto ORIGINAL concatenado (end exclusivo). */
export interface TextMatch {
  start: number;
  end: number;
}

/** Trecho (item do pdf.js / nó de texto) dentro do texto concatenado. */
export interface Piece {
  start: number;
  length: number;
}

/** Pedaço de uma ocorrência dentro de UMA peça (offsets relativos à peça). */
export interface Segment {
  piece: number;
  start: number;
  end: number;
}

const SPACE_RE = /\s/;

export function normalizeForSearch(text: string): Normalized {
  const norm: string[] = [];
  const map: number[] = [];
  let pendingSpace = -1; // índice original do 1º espaço do run em aberto (-1 = nenhum)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (SPACE_RE.test(ch)) {
      if (pendingSpace < 0) pendingSpace = i;
      continue;
    }
    if (pendingSpace >= 0) {
      // run de espaço vira UM " " (nunca no início do texto)
      if (norm.length > 0) {
        norm.push(" ");
        map.push(pendingSpace);
      }
      pendingSpace = -1;
    }
    // NFKD separa base + marcas (que caem) e decompõe ligaduras/compatibilidade
    const d = ch.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
    for (const c of d) {
      norm.push(c);
      map.push(i);
    }
  }
  return { norm: norm.join(""), map };
}

export function buildText(
  parts: { text: string; sepAfter?: boolean }[],
): { text: string; pieces: Piece[] } {
  let text = "";
  const pieces: Piece[] = [];
  for (const p of parts) {
    pieces.push({ start: text.length, length: p.text.length });
    text += p.text;
    if (p.sepAfter) text += " ";
  }
  return { text, pieces };
}

/** Ocorrências não sobrepostas da consulta (normalizada) no texto normalizado. */
export function findMatches(text: Normalized, query: string): TextMatch[] {
  const q = normalizeForSearch(query).norm;
  if (!q) return [];
  const out: TextMatch[] = [];
  let from = 0;
  for (;;) {
    const i = text.norm.indexOf(q, from);
    if (i < 0) break;
    out.push({ start: text.map[i], end: text.map[i + q.length - 1] + 1 });
    from = i + q.length;
  }
  return out;
}

/** Fatia a ocorrência nas peças que ela atravessa (separadores ficam de fora). */
export function splitMatch(m: TextMatch, pieces: Piece[]): Segment[] {
  // 1ª peça cujo FIM passa do início da ocorrência (busca binária; peças ordenadas)
  let lo = 0;
  let hi = pieces.length - 1;
  let first = pieces.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pieces[mid].start + pieces[mid].length > m.start) {
      first = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  const segs: Segment[] = [];
  for (let p = first; p < pieces.length; p++) {
    const pc = pieces[p];
    if (pc.start >= m.end) break;
    const s = Math.max(m.start, pc.start) - pc.start;
    const e = Math.min(m.end, pc.start + pc.length) - pc.start;
    if (e > s) segs.push({ piece: p, start: s, end: e });
  }
  return segs;
}
