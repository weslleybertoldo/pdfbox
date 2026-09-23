/**
 * Parágrafo vazio do Word ocupa UMA linha na fonte da marca de parágrafo
 * (w:pPr/w:rPr — no ofício da FABd, Times 12 pt: 14,84 pt com entrelinha 1,08).
 * A docx-preview ignora a marca e o parágrafo sem texto fica com o min-height
 * de 1em da fonte de base (12 pt), então cada linha em branco encolhia ~3 pt e
 * a assinatura subia. Aqui, antes do render, o parágrafo sem conteúdo ganha uma
 * run com um espaço de largura zero e a formatação da marca: a linha passa a
 * existir, com a fonte certa.
 *
 * Mesmas regras do pageFields: DOMParser/XMLSerializer globais e só API DOM
 * nível 2, pra rodar no browser e nos testes (@xmldom/xmldom).
 */
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const EMPTY_LINE = "​";

/** O que faz o parágrafo não ser vazio além de texto (imagem, quebra, campo, nota...). */
const CONTENT = new Set([
  "drawing", "pict", "object", "tab", "ptab", "br", "cr", "sym", "fldSimple", "fldChar",
  "footnoteReference", "endnoteReference", "noBreakHyphen", "softHyphen", "txbxContent",
]);
/** Marcas de revisão da marca de parágrafo: não valem dentro de uma run. */
const MARK_ONLY = new Set(["ins", "del", "moveFrom", "moveTo", "rPrChange"]);

const isW = (n: Node | null, local: string): n is Element =>
  !!n && n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === local;

function hasContent(p: Element): boolean {
  const walk = (n: Node): boolean => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || (c as Element).namespaceURI !== W) continue;
      const local = (c as Element).localName;
      if (local === "pPr") continue;
      if (CONTENT.has(local)) return true;
      if ((local === "t" || local === "delText" || local === "instrText") && (c.textContent ?? "") !== "") return true;
      if (walk(c)) return true;
    }
    return false;
  };
  return walk(p);
}

export function fillEmptyParagraphs(xml: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return xml;
  }
  if (!doc?.documentElement || doc.getElementsByTagName("parsererror").length > 0) return xml;
  let changed = false;
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    if (hasContent(p)) continue;
    const pPr = Array.from(p.childNodes).find((c) => isW(c, "pPr")) as Element | undefined;
    const mark = pPr ? (Array.from(pPr.childNodes).find((c) => isW(c, "rPr")) as Element | undefined) : undefined;
    const r = doc.createElementNS(W, "w:r");
    if (mark) {
      const rPr = mark.cloneNode(true) as Element;
      for (const c of Array.from(rPr.childNodes)) {
        if (c.nodeType === 1 && MARK_ONLY.has((c as Element).localName)) rPr.removeChild(c);
      }
      r.appendChild(rPr);
    }
    const t = doc.createElementNS(W, "w:t");
    t.textContent = EMPTY_LINE;
    r.appendChild(t);
    p.appendChild(r);
    changed = true;
  }
  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}
