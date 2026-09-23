/**
 * Número de página do Word (campos PAGE e NUMPAGES). A docx-preview descarta o
 * campo simples (w:fldSimple não tem render) e, no complexo, mostra o valor
 * SALVO no arquivo — "1" em toda página. Antes do render, o resultado do campo
 * vira um marcador; depois da paginação, cada página troca o marcador pelo
 * número real (fillPageMarks). Marcadores na área de uso privado do Unicode:
 * não colidem com texto de verdade.
 *
 * Usa DOMParser/XMLSerializer globais (browser; nos testes, @xmldom/xmldom) e
 * só API DOM nível 2 (childNodes/insertBefore) pra rodar nos dois.
 */
export const PAGE_MARK = "P";
export const NUMPAGES_MARK = "N";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const markFor = (instr: string): string | null => {
  const code = instr.trim().split(/\s+/)[0]?.toUpperCase();
  return code === "PAGE" ? PAGE_MARK : code === "NUMPAGES" ? NUMPAGES_MARK : null;
};

const wAttr = (el: Element, name: string): string =>
  el.getAttributeNS(W, name) || el.getAttribute(`w:${name}`) || "";

const isW = (n: Node, local: string): n is Element =>
  n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === local;

const textsOf = (el: Element): Element[] => Array.from(el.getElementsByTagNameNS(W, "t"));

/** 1º w:t recebe o marcador; os outros ficam vazios. */
const putMark = (ts: Element[], mark: string) => {
  ts.forEach((t, i) => {
    t.textContent = i === 0 ? mark : "";
  });
};

export function markPageFields(xml: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return xml;
  }
  if (!doc?.documentElement || doc.getElementsByTagName("parsererror").length > 0) return xml;
  let changed = false;

  // 1) campo simples: sempre desembrulha (a lib não renderiza w:fldSimple);
  //    PAGE/NUMPAGES ganham o marcador no lugar do valor salvo
  for (const fs of Array.from(doc.getElementsByTagNameNS(W, "fldSimple"))) {
    const parent = fs.parentNode;
    if (!parent) continue;
    const mark = markFor(wAttr(fs, "instr"));
    const kids = Array.from(fs.childNodes);
    if (mark) {
      const ts = kids.flatMap((k) => (k.nodeType === 1 ? textsOf(k as Element) : []));
      if (ts.length > 0) putMark(ts, mark);
      else {
        const r = doc.createElementNS(W, "w:r");
        const t = doc.createElementNS(W, "w:t");
        t.textContent = mark;
        r.appendChild(t);
        kids.push(r);
      }
    }
    for (const k of kids) parent.insertBefore(k, fs);
    parent.removeChild(fs);
    changed = true;
  }

  // 2) campo complexo: begin → instrText → separate → resultado → end, em runs
  //    irmãs ou numa run só (pilha: campo dentro de campo mexe só no de dentro).
  //    Sem valor salvo (comum em .docx gerado por biblioteca), o marcador entra
  //    como um w:t novo logo depois do separate (ou antes do end, se não tem).
  const stack: { instr: string; inResult: boolean; ts: Element[]; sep: Element | null }[] = [];
  for (const r of Array.from(doc.getElementsByTagNameNS(W, "r"))) {
    for (const c of Array.from(r.childNodes)) {
      const top = stack[stack.length - 1];
      if (isW(c, "fldChar")) {
        const type = wAttr(c, "fldCharType");
        if (type === "begin") stack.push({ instr: "", inResult: false, ts: [], sep: null });
        else if (type === "separate" && top) {
          top.inResult = true;
          top.sep = c;
        } else if (type === "end" && top) {
          stack.pop();
          const mark = markFor(top.instr);
          if (!mark) continue;
          if (top.ts.length > 0) putMark(top.ts, mark);
          else {
            const t = doc.createElementNS(W, "w:t");
            t.textContent = mark;
            const anchor = top.sep ?? c;
            anchor.parentNode?.insertBefore(t, top.sep ? top.sep.nextSibling : c);
          }
          changed = true;
        }
      } else if (isW(c, "instrText") && top && !top.inResult) {
        top.instr += c.textContent ?? "";
      } else if (isW(c, "t") && top?.inResult) {
        top.ts.push(c);
      }
    }
  }
  // 3) run com campo misturado a texto: a docx-preview pula a run INTEIRA quando
  //    ela tem fldChar/instrText (renderRun → fieldRun) e o texto some junto
  //    (.docx gerado por biblioteca põe "Página " + campo numa run só). Separa:
  //    cada fldChar/instrText na própria run; o resto em runs com a mesma formatação.
  const isField = (e: Node) => isW(e, "fldChar") || isW(e, "instrText");
  for (const r of Array.from(doc.getElementsByTagNameNS(W, "r"))) {
    const kids = Array.from(r.childNodes).filter((n): n is Element => n.nodeType === 1);
    if (!kids.some(isField) || kids.every((e) => isField(e) || isW(e, "rPr"))) continue;
    const parent = r.parentNode;
    if (!parent) continue;
    const rPr = kids.find((e) => isW(e, "rPr")) ?? null;
    const newRun = () => {
      const n = doc.createElementNS(W, "w:r");
      if (rPr) n.appendChild(rPr.cloneNode(true));
      parent.insertBefore(n, r);
      return n;
    };
    let cur: Element | null = null;
    for (const e of kids) {
      if (e === rPr) continue;
      if (isField(e)) {
        newRun().appendChild(e);
        cur = null;
      } else (cur ??= newRun()).appendChild(e);
    }
    parent.removeChild(r);
    changed = true;
  }

  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}

/** Troca os marcadores pelo número da página e o total (nós de texto sob root). */
export function fillPageMarks(root: Node, page: number, total: number): void {
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const t = n as CharacterData;
      if (t.data.includes("")) {
        t.data = t.data.split(PAGE_MARK).join(String(page)).split(NUMPAGES_MARK).join(String(total));
      }
      return;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
}
