/**
 * Núcleo PURO do paginador do Word (sem DOM): decide onde cortar uma página a
 * partir das caixas medidas. Coordenadas em px, relativas ao topo da página.
 */
export const EPS = 0.5;

/** Classe das páginas da docx-preview (className das opções). */
export const DOCX_CLASS = "docxv";

export interface Box {
  top: number;
  bottom: number;
}

export interface BlockInfo extends Box {
  kind: "p" | "table" | "other";
  /** linhas do parágrafo (só do bloco candidato ao corte) */
  lines?: Box[];
  /** linhas (tr) da tabela (só do bloco candidato ao corte) */
  rows?: Box[];
}

export type Cut =
  | { index: number; mode: "before" }
  | { index: number; mode: "lines"; keep: number }
  | { index: number; mode: "rows"; keep: number };

/**
 * Onde cortar: 1º bloco cujo fundo passa de `limit`. Parágrafo fica com o que
 * cabe, com no mínimo 2 linhas de cada lado (viúva/órfã); tabela fica com as
 * linhas que cabem; senão o bloco inteiro desce. No topo da página o bloco não
 * pode descer inteiro (a próxima página também começaria com ele), então corta
 * onde der; sem ponto de corte → null (transborda).
 */
export function findCut(blocks: BlockInfo[], limit: number): Cut | null {
  const index = blocks.findIndex((b) => b.bottom > limit + EPS);
  if (index < 0) return null;
  const b = blocks[index];
  if (b.kind === "p" && b.lines && b.lines.length > 0) {
    const n = b.lines.length;
    const fit = b.lines.filter((l) => l.bottom <= limit + EPS).length;
    const keep = index === 0 ? fit : Math.min(fit, n - 2);
    if (keep >= 2 || (index === 0 && keep >= 1)) return { index, mode: "lines", keep };
  }
  if (b.kind === "table" && b.rows && b.rows.length > 1) {
    const keep = b.rows.filter((r) => r.bottom <= limit + EPS).length;
    if (keep >= 1 && keep < b.rows.length) return { index, mode: "rows", keep };
  }
  return index === 0 ? null : { index, mode: "before" };
}

const PX_PER: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

/** "841.9pt" → px (unidades que a docx-preview escreve no style); inválido → 0. */
export function cssLengthToPx(v: string): number {
  const m = /^\s*(-?[\d.]+)\s*(px|pt|in|cm|mm)?\s*$/i.exec(v ?? "");
  if (!m) return 0;
  return parseFloat(m[1]) * PX_PER[(m[2] ?? "px").toLowerCase()];
}
