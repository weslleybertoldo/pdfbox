import { cssLengthToPx, findCut, EPS, DOCX_CLASS, type BlockInfo, type Box } from "./paginateCore";
import { fillPageMarks } from "./pageFields";

/** Cabeçalho/rodapé a usar numa página (null = não tem). */
export interface Chrome {
  header: Element | null;
  footer: Element | null;
}
/** Variante de cabeçalho/rodapé pela posição (1-based) da página; undefined = clonar a de origem. */
export type ChromeFor = (pageNumber: number) => Chrome | undefined;

/** Estilo computado na janela DO elemento (a conversão roda num iframe). */
const cs = (el: Element) => el.ownerDocument.defaultView!.getComputedStyle(el);

const pagesOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>(`section.${DOCX_CLASS}`));

const kindOf = (el: Element): BlockInfo["kind"] =>
  el.tagName === "P" ? "p" : el.tagName === "TABLE" ? "table" : "other";

/** Limite de baixo do conteúdo (px, relativo ao topo da página) na altura nominal. */
function contentLimit(section: HTMLElement, lastArticle: Element): number {
  const pageH = cssLengthToPx(section.style.minHeight) || section.getBoundingClientRect().height;
  const padB = parseFloat(cs(section).paddingBottom) || 0;
  let trailing = 0; // notas + rodapé (a margem negativa do rodapé entra na conta)
  for (let el = lastArticle.nextElementSibling; el; el = el.nextElementSibling) {
    const s = cs(el);
    trailing +=
      el.getBoundingClientRect().height + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0);
  }
  return pageH - padB - trailing;
}

/** Linhas do parágrafo: retângulos do Range agrupados por faixa vertical. */
function lineBoxes(p: Element, top0: number): Box[] {
  const range = p.ownerDocument.createRange();
  range.selectNodeContents(p);
  const lines: Box[] = [];
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
  for (const r of rects.sort((a, b) => a.top - b.top)) {
    const top = r.top - top0;
    const bottom = r.bottom - top0;
    const hit = lines.find(
      (l) => Math.min(l.bottom, bottom) - Math.max(l.top, top) > Math.min(l.bottom - l.top, bottom - top) / 2,
    );
    if (hit) {
      hit.top = Math.min(hit.top, top);
      hit.bottom = Math.max(hit.bottom, bottom);
    } else lines.push({ top, bottom });
  }
  return lines.sort((a, b) => a.top - b.top);
}

const rowBoxes = (t: HTMLTableElement, top0: number): Box[] =>
  Array.from(t.rows).map((r) => {
    const b = r.getBoundingClientRect();
    return { top: b.top - top0, bottom: b.bottom - top0 };
  });

/** Topo (viewport) do caractere i do nó de texto; -Infinity se não tem caixa. */
function charTop(range: Range, t: Text, i: number): number {
  range.setStart(t, i);
  range.setEnd(t, i + 1);
  const rs = range.getClientRects();
  return rs.length > 0 ? rs[0].top : -Infinity;
}

/**
 * Divide o parágrafo na linha que começa abaixo de `splitY` (viewport): o que
 * vem depois vai pra um clone raso do <p> (Range.extractContents clona os spans
 * parcialmente cortados). A continuação perde o recuo de 1ª linha e o marcador
 * de lista; a última linha que fica continua justificada.
 */
function splitParagraph(p: HTMLElement, splitY: number): HTMLElement {
  const doc = p.ownerDocument;
  const probe = doc.createRange();
  const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let at: { node: Text; offset: number } | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.length === 0 || charTop(probe, n, n.length - 1) < splitY) continue;
    let lo = 0;
    let hi = n.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (charTop(probe, n, mid) >= splitY) hi = mid;
      else lo = mid + 1;
    }
    at = { node: n, offset: lo };
    break;
  }
  const tail = p.cloneNode(false) as HTMLElement;
  tail.setAttribute("data-pg-cont", "");
  tail.style.textIndent = "0";
  if (!at || !p.lastChild) return tail;
  const cut = doc.createRange();
  cut.setStart(at.node, at.offset);
  cut.setEndAfter(p.lastChild);
  tail.appendChild(cut.extractContents());
  const first = doc.createTreeWalker(tail, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
  if (first) first.data = first.data.replace(/^\s+/, "");
  if (cs(p).textAlign === "justify") p.style.textAlignLast = "justify";
  return tail;
}

/** Divide a tabela: as linhas a partir de `keep` vão pra um clone raso (com o colgroup). */
function splitTable(table: HTMLTableElement, keep: number): HTMLTableElement {
  const rows = Array.from(table.rows);
  const tail = table.cloneNode(false) as HTMLTableElement;
  const colgroup = table.querySelector(":scope > colgroup");
  if (colgroup) tail.appendChild(colgroup.cloneNode(true));
  const parent = rows[keep].parentElement;
  const target = parent && parent !== table ? tail.appendChild(parent.cloneNode(false)) : tail;
  for (const r of rows.slice(keep)) target.appendChild(r);
  return tail;
}

/** Troca cabeçalho/rodapé da página pela variante pedida. */
function applyChrome(section: HTMLElement, chrome: Chrome): void {
  section.querySelector(":scope > header")?.remove();
  section.querySelector(":scope > footer")?.remove();
  if (chrome.header) section.prepend(chrome.header.cloneNode(true));
  if (chrome.footer) section.append(chrome.footer.cloneNode(true));
}

/** Página nova depois de `section`: mesmo tamanho/margens, article vazio, cabeçalho/rodapé. */
function newPageAfter(section: HTMLElement, article: Element, chrome: Chrome | undefined): HTMLElement {
  const page = section.cloneNode(false) as HTMLElement;
  const header = chrome ? chrome.header : section.querySelector(":scope > header");
  const footer = chrome ? chrome.footer : section.querySelector(":scope > footer");
  if (header) page.appendChild(header.cloneNode(true));
  page.appendChild(article.cloneNode(false));
  if (footer) page.appendChild(footer.cloneNode(true));
  section.after(page);
  return page;
}

/**
 * Quebra a página se o conteúdo passar da altura útil: o que não cabe vai pra
 * uma página nova logo depois (que é processada na sequência).
 */
function splitOverflow(section: HTMLElement, nextChrome: Chrome | undefined): void {
  const articles = section.querySelectorAll<HTMLElement>(":scope > article");
  if (articles.length !== 1) return; // várias subseções na mesma página: não pagina
  const article = articles[0];
  if (article.style.columnCount && article.style.columnCount !== "1") return; // colunas: transborda
  const limit = contentLimit(section, article);
  const top0 = section.getBoundingClientRect().top;
  const children = Array.from(article.children) as HTMLElement[];
  const blocks: BlockInfo[] = children.map((el) => {
    const r = el.getBoundingClientRect();
    return { kind: kindOf(el), top: r.top - top0, bottom: r.bottom - top0 };
  });
  const over = blocks.findIndex((b) => b.bottom > limit + EPS);
  if (over < 0) return;
  if (blocks[over].kind === "p") blocks[over].lines = lineBoxes(children[over], top0);
  if (blocks[over].kind === "table") blocks[over].rows = rowBoxes(children[over] as HTMLTableElement, top0);
  const cut = findCut(blocks, limit);
  if (!cut) return;
  const next = newPageAfter(section, article, nextChrome);
  const nextArticle = next.querySelector(":scope > article")!;
  let moveFrom = cut.index;
  if (cut.mode === "lines") {
    const lines = blocks[cut.index].lines!;
    // meio entre os TOPOS das linhas: a caixa do texto (ascendente+descendente)
    // é mais alta que a linha com espaçamento 1,15 e as caixas se sobrepõem —
    // o meio do vão caía dentro da linha seguinte e o corte saía 1 linha depois
    const splitY = top0 + (lines[cut.keep - 1].top + lines[cut.keep].top) / 2;
    nextArticle.appendChild(splitParagraph(children[cut.index], splitY));
    moveFrom = cut.index + 1;
  } else if (cut.mode === "rows") {
    nextArticle.appendChild(splitTable(children[cut.index] as HTMLTableElement, cut.keep));
    moveFrom = cut.index + 1;
  }
  for (const el of children.slice(moveFrom)) nextArticle.appendChild(el);
}

/**
 * Pagina por transbordo (a docx-preview só quebra em quebra explícita) e
 * preenche os números de página. Precisa do DOM visível e SEM zoom/transform
 * (mede em px do documento). Devolve o total de páginas.
 */
export function paginate(pagesEl: HTMLElement, chromeFor?: ChromeFor): number {
  // sem instanceof: no iframe da conversão os nós são de OUTRA janela
  let section: HTMLElement | null = pagesOf(pagesEl)[0] ?? null;
  for (let n = 1; section; n++) {
    const own = chromeFor?.(n);
    if (own) applyChrome(section, own);
    splitOverflow(section, chromeFor?.(n + 1));
    const next = section.nextElementSibling as HTMLElement | null;
    section = next?.matches(`section.${DOCX_CLASS}`) ? next : null;
  }
  const pages = pagesOf(pagesEl);
  pages.forEach((p, i) => {
    // espaço-depois do último bloco não empurra a página (o corte mediu a borda
    // do bloco, sem margem — como no Word, que ignora esse espaço no fim da página)
    const last = p.querySelector(":scope > article")?.lastElementChild as HTMLElement | null;
    if (last) last.style.marginBottom = "0";
    fillPageMarks(p, i + 1, pages.length);
  });
  return pages.length;
}
