/**
 * Tabulação do Word (w:tab). A docx-preview troca todo w:tab por um espaço fixo
 * (U+2003) — e o modo experimental, que calcula as paradas, faz isso 500 ms
 * DEPOIS do render, já com a paginação feita. Aqui: antes do render, cada w:tab
 * vira um marcador com as paradas do parágrafo (as do estilo + as dele) e o
 * espaçamento padrão do documento (markTabs); depois do render, o marcador vira
 * um <span> (expandTabMarks) e, com as fontes carregadas, cada span ganha a
 * largura até a parada certa (layoutTabs). Ex.: rodapé com o CNPJ numa parada
 * central (ofício da FABd, 23/09/2026).
 *
 * Mesmas regras do pageFields: DOMParser/XMLSerializer globais e só API DOM
 * nível 2, pra rodar no browser e nos testes (@xmldom/xmldom).
 */
import { DOCX_CLASS } from "./paginateCore";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const TAB_CLASS = `${DOCX_CLASS}-tab`;
const OPEN = "";
const CLOSE = "";
const MARK_RE = /([^]*)/;
/** Espaçamento padrão do Word quando o settings.xml não diz (720 twips = 1,27 cm). */
export const DEFAULT_TAB_TWIPS = 720;
const PX_TO_PT = 0.75;

export type TabKind = "l" | "c" | "r" | "d";
export type TabLeader = "" | "." | "_";
export interface TabStop {
  kind: TabKind;
  /** twips (1/20 pt), a partir da margem esquerda do texto */
  pos: number;
  leader: TabLeader;
}
export interface TabSpec {
  defTwips: number;
  stops: TabStop[];
}

const isW = (n: Node | null, local: string): n is Element =>
  !!n && n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === local;
const wAttr = (el: Element, name: string): string =>
  el.getAttributeNS(W, name) || el.getAttribute(`w:${name}`) || "";
const childrenW = (el: Element | null, local: string): Element[] =>
  el ? Array.from(el.childNodes).filter((n): n is Element => isW(n, local)) : [];

const KIND: Record<string, TabKind> = { left: "l", start: "l", num: "l", center: "c", right: "r", end: "r", decimal: "d" };
const LEADER: Record<string, TabLeader> = { dot: ".", middleDot: ".", hyphen: "_", underscore: "_", heavy: "_" };

/** Aplica os w:tab de um w:tabs sobre as paradas herdadas: "clear" tira a da mesma posição; "bar" não é parada. */
function applyTabs(stops: Map<number, TabStop>, tabsEl: Element | null): void {
  for (const t of childrenW(tabsEl, "tab")) {
    const pos = parseInt(wAttr(t, "pos"), 10);
    if (!Number.isFinite(pos)) continue;
    const val = wAttr(t, "val");
    if (val === "clear") stops.delete(pos);
    else if (KIND[val] && pos >= 0) stops.set(pos, { kind: KIND[val], pos, leader: LEADER[wAttr(t, "leader")] ?? "" });
  }
}

export interface StyleTabs {
  byId: Map<string, { basedOn: string; tabs: Element | null }>;
  defaultId: string;
}

/** Paradas dos estilos de parágrafo do styles.xml (com o basedOn de cada um). */
export function readStyleTabs(stylesXml: string): StyleTabs {
  const byId: StyleTabs["byId"] = new Map();
  let defaultId = "";
  let doc: Document | null = null;
  try {
    doc = stylesXml ? new DOMParser().parseFromString(stylesXml, "application/xml") : null;
  } catch {
    doc = null;
  }
  if (!doc?.documentElement || doc.getElementsByTagName("parsererror").length > 0) return { byId, defaultId };
  for (const s of Array.from(doc.getElementsByTagNameNS(W, "style"))) {
    if (wAttr(s, "type") !== "paragraph") continue;
    const id = wAttr(s, "styleId");
    const basedOn = childrenW(s, "basedOn")[0];
    const pPr = childrenW(s, "pPr")[0] ?? null;
    byId.set(id, { basedOn: basedOn ? wAttr(basedOn, "val") : "", tabs: childrenW(pPr, "tabs")[0] ?? null });
    if (/^(1|true|on)$/.test(wAttr(s, "default"))) defaultId = id;
  }
  return { byId, defaultId };
}

function paragraphStops(p: Element, styles: StyleTabs): TabStop[] {
  const pPr = childrenW(p, "pPr")[0] ?? null;
  const pStyle = childrenW(pPr, "pStyle")[0];
  const chain: (Element | null)[] = [];
  const seen = new Set<string>();
  for (let id = pStyle ? wAttr(pStyle, "val") : styles.defaultId; id && !seen.has(id); ) {
    seen.add(id);
    const st = styles.byId.get(id);
    if (!st) break;
    chain.unshift(st.tabs);
    id = st.basedOn;
  }
  const stops = new Map<number, TabStop>();
  for (const tabs of chain) applyTabs(stops, tabs);
  applyTabs(stops, childrenW(pPr, "tabs")[0] ?? null);
  return [...stops.values()].sort((a, b) => a.pos - b.pos);
}

export const encodeTabSpec = (s: TabSpec): string =>
  `${s.defTwips}|${s.stops.map((t) => `${t.kind}${t.pos}${t.leader}`).join(",")}`;

export function parseTabSpec(raw: string): TabSpec {
  const [def, list = ""] = raw.split("|");
  const defTwips = parseInt(def, 10) > 0 ? parseInt(def, 10) : DEFAULT_TAB_TWIPS;
  const stops: TabStop[] = [];
  for (const m of list.matchAll(/([lcrd])(\d+)([._]?)/g)) {
    stops.push({ kind: m[1] as TabKind, pos: parseInt(m[2], 10), leader: m[3] as TabLeader });
  }
  return { defTwips, stops: stops.sort((a, b) => a.pos - b.pos) };
}

/** Troca cada w:tab de run por um w:t com o marcador das paradas do parágrafo dele. */
export function markTabs(xml: string, styles: StyleTabs, defTwips: number): string {
  if (!/<(\w+:)?tab[\s/>]/.test(xml)) return xml;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return xml;
  }
  if (!doc?.documentElement || doc.getElementsByTagName("parsererror").length > 0) return xml;
  const specOf = new Map<Element, string>();
  let changed = false;
  for (const tab of Array.from(doc.getElementsByTagNameNS(W, "tab"))) {
    if (!isW(tab.parentNode, "r")) continue; // w:tab de w:tabs é definição de parada, não tabulação
    let p: Node | null = tab.parentNode;
    while (p && !isW(p, "p")) p = p.parentNode;
    let spec = "";
    if (p) {
      spec = specOf.get(p as Element) ?? encodeTabSpec({ defTwips, stops: paragraphStops(p as Element, styles) });
      specOf.set(p as Element, spec);
    } else spec = encodeTabSpec({ defTwips, stops: [] });
    const t = doc.createElementNS(W, "w:t");
    t.textContent = `${OPEN}${spec}${CLOSE}`;
    tab.parentNode!.replaceChild(t, tab);
    changed = true;
  }
  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}

/**
 * Troca os marcadores de tabulação (nós de texto sob root) por
 * <span class=TAB_CLASS data-tab=...> com o espaço fixo de antes — logo depois
 * do render, pra marcador nunca aparecer na tela.
 */
export function expandTabMarks(root: Node): void {
  const doc = root.ownerDocument ?? (root as Document);
  const hits: Text[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      if ((n as Text).data.includes(OPEN)) hits.push(n as Text);
      return;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
  for (const t of hits) {
    const parent = t.parentNode;
    if (!parent) continue;
    const parts = t.data.split(MARK_RE); // texto, spec, texto, spec, ..., texto
    parts.forEach((s, i) => {
      if (i % 2 === 0) {
        if (s) parent.insertBefore(doc.createTextNode(s), t);
        return;
      }
      const span = doc.createElement("span");
      span.setAttribute("class", TAB_CLASS);
      span.setAttribute("data-tab", s);
      span.appendChild(doc.createTextNode(" "));
      parent.insertBefore(span, t);
    });
    parent.removeChild(t);
  }
}

/**
 * Largura (pt) de uma tabulação que começa em x (pt, a partir da margem do
 * texto): 1ª parada à direita de x; sem nenhuma, a próxima padrão depois da
 * última (o Word apaga as padrão à esquerda de uma parada própria). Centro e
 * direita descontam o trecho seguinte (seg, pt); decimal vai como direita.
 * `room`: espaço até o fim da linha — o trecho alinhado não pode passar dele
 * (senão quebra de linha).
 */
export function tabWidth(spec: TabSpec, x: number, seg: number, room: number, indent = 0): { width: number; leader: TabLeader } {
  const stops = spec.stops.map((s) => ({ ...s, pt: s.pos / 20 }));
  if (indent > 0 && !stops.some((s) => Math.abs(s.pt - indent) < 0.5)) {
    stops.push({ kind: "l", pos: indent * 20, leader: "", pt: indent }); // recuo deslocado = parada implícita
    stops.sort((a, b) => a.pt - b.pt);
  }
  const eps = 0.1;
  let stop = stops.find((s) => s.pt > x + eps);
  if (!stop) {
    const def = spec.defTwips / 20;
    const from = Math.max(x, stops.length ? stops[stops.length - 1].pt : 0);
    stop = { kind: "l", pos: 0, leader: "", pt: (Math.floor((from + eps) / def) + 1) * def };
  }
  let width = stop.pt - x;
  if (stop.kind !== "l") {
    width -= stop.kind === "c" ? seg / 2 : seg;
    width = Math.min(width, room - seg - 0.5);
  }
  return { width: Math.max(0, width), leader: stop.leader };
}

/**
 * Dá a cada tabulação a largura até a parada dela, medindo no layout real
 * (fontes já carregadas). Em rodadas: a k-ésima tabulação de TODOS os
 * parágrafos numa leitura só e depois as escritas — a posição de uma depende
 * das anteriores do mesmo parágrafo, mas não de outro parágrafo. Mede em px
 * visuais e desfaz a escala (transform do palco) pela razão rect/offsetWidth.
 * Parágrafo centralizado ou à direita fica com o espaço fixo.
 */
export function layoutTabs(root: HTMLElement): void {
  const byP = new Map<HTMLElement, HTMLElement[]>();
  for (const span of Array.from(root.querySelectorAll<HTMLElement>(`span.${TAB_CLASS}`))) {
    const p = span.closest("p");
    if (!p) continue;
    const list = byP.get(p);
    if (list) list.push(span);
    else byP.set(p, [span]);
  }
  const rounds = Math.max(0, ...Array.from(byP.values(), (l) => l.length));
  for (let k = 0; k < rounds; k++) {
    const writes: [HTMLElement, { width: number; leader: TabLeader }][] = [];
    for (const [p, spans] of byP) {
      const span = spans[k];
      if (!span) continue;
      const cs = getComputedStyle(p);
      if (/^(center|right|end)$/.test(cs.textAlign) || !p.offsetWidth) continue;
      const pr = p.getBoundingClientRect();
      const ratio = pr.width / p.offsetWidth;
      if (!(ratio > 0)) continue;
      const toPt = (px: number) => (px / ratio) * PX_TO_PT;
      const marginLeft = parseFloat(cs.marginLeft) || 0;
      const origin = pr.left - marginLeft * ratio;
      const sr = span.getBoundingClientRect();
      const range = p.ownerDocument.createRange();
      range.setStartAfter(span);
      if (spans[k + 1]) range.setEndBefore(spans[k + 1]);
      else range.setEnd(p, p.childNodes.length);
      const seg = toPt(range.getBoundingClientRect().width);
      const hanging = (parseFloat(cs.textIndent) || 0) < 0 ? marginLeft * PX_TO_PT : 0;
      const x = toPt(sr.left - origin);
      writes.push([span, tabWidth(parseTabSpec(span.dataset.tab ?? ""), x, seg, toPt(pr.right - sr.left), hanging)]);
    }
    for (const [span, { width, leader }] of writes) {
      span.textContent = "";
      span.style.display = "inline-block";
      span.style.minHeight = "0"; // o ".docxv span" da lib dá min-height de 1 corpo: esticava a linha (+1,2 pt)
      span.style.width = `${width.toFixed(2)}pt`;
      if (leader) span.style.borderBottom = `1px ${leader === "." ? "dotted" : "solid"} currentColor`;
    }
  }
}
