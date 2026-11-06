/**
 * Caixas VML ancoradas (grupo / caixa de texto / imagem do Word, comuns no .doc
 * antigo convertido): o patch do docx-preview (patches/docx-preview+0.4.1.patch)
 * desenha cada objeto como HTML numa CAMADA absoluta presa à âncora — o ponto do
 * texto onde está o <w:pict>. No Word a posição é relativa à coluna/margem, ao
 * parágrafo ou à página (mso-position-*-relative); só depois do layout dá pra
 * saber onde essas origens caem, então esta função move cada camada pra origem
 * certa. Idempotente (recalcula sempre a partir da âncora): roda depois do render
 * e de novo depois da paginação, que pode levar o parágrafo pra outra página.
 */
import { DOCX_CLASS } from "./paginateCore";

interface Ponto {
  x: number;
  y: number;
}

/** Posição de `el` dentro de `base` (px de layout, sem zoom/transform). */
function offsetIn(el: HTMLElement, base: HTMLElement): Ponto | null {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== base) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const pai = n.offsetParent as HTMLElement | null;
    // célula de tabela: offsetLeft não inclui a borda do pai posicionado
    if (pai && pai !== base) {
      x += pai.clientLeft;
      y += pai.clientTop;
    }
    n = pai;
  }
  return n === base ? { x, y } : null;
}

const px = (v: string): number => parseFloat(v) || 0;

/** Origem horizontal (px na página) pra `rel` — coluna/margem é o padrão do Word. */
export function horizontalOrigin(rel: string, page: { padLeft: number }, anchorX: number): number {
  switch (rel) {
    case "page":
      return 0;
    case "char":
      return anchorX;
    default: // "margin", "text" (coluna), "left-margin-area"…
      return page.padLeft;
  }
}

/** Origem vertical (px na página) pra `rel` — parágrafo da âncora é o padrão. */
export function verticalOrigin(
  rel: string,
  page: { padTop: number },
  paraY: number,
  anchorY: number,
): number {
  switch (rel) {
    case "page":
      return 0;
    case "margin":
    case "top-margin-area":
      return page.padTop;
    case "line":
      return anchorY;
    default: // "text" = parágrafo
      return paraY;
  }
}

/**
 * Propriedades herdáveis que a caixa NÃO pode pegar do parágrafo da âncora (no
 * Word o texto da caixa não herda nada da linha onde ela está ancorada — no
 * modelo, a âncora fica num parágrafo vermelho, itálico e centralizado). A caixa
 * recebe os valores da página (padrões do documento) e os parágrafos de dentro
 * aplicam os próprios estilos por cima.
 */
const HERDADAS = [
  "color", "fontFamily", "fontSize", "fontStyle", "fontWeight", "fontVariant", "lineHeight",
  "letterSpacing", "wordSpacing", "textAlign", "textIndent", "textTransform", "whiteSpace",
] as const;

function isolar(el: HTMLElement, pageCss: CSSStyleDeclaration): void {
  for (const prop of HERDADAS) el.style[prop] = pageCss[prop];
}

/** Move cada camada VML pra origem que o Word usa (ver o cabeçalho do arquivo). */
export function placeVmlLayers(root: ParentNode): number {
  let n = 0;
  const reservas = new Map<HTMLElement, number>(); // parágrafo → espaço (px) da figura "acima e abaixo"
  for (const holder of Array.from(root.querySelectorAll<HTMLElement>(`.${DOCX_CLASS}-vml-inline`))) {
    const page = holder.closest<HTMLElement>(`section.${DOCX_CLASS}`);
    const css = page?.ownerDocument.defaultView?.getComputedStyle(page);
    if (css) isolar(holder, css);
  }
  for (const layer of Array.from(root.querySelectorAll<HTMLElement>(`.${DOCX_CLASS}-vml-layer`))) {
    const anchor = layer.parentElement;
    const page = layer.closest<HTMLElement>(`section.${DOCX_CLASS}`);
    if (!anchor || !page) continue;
    const view = page.ownerDocument.defaultView;
    const pageCss = view?.getComputedStyle(page);
    if (pageCss) isolar(layer, pageCss);
    if (pageCss?.position === "static") page.style.position = "relative";
    // "atrás do texto" (z-index -1) pinta acima do fundo da página, não por baixo dela
    page.style.isolation = "isolate";
    // âncora sai de DENTRO do parágrafo e vira irmã dele, logo antes: o CSS de
    // estilo de parágrafo da lib (".docxv_titulo1 span { font-style: italic }")
    // pegava o texto da caixa (no .docx do formulário preenchido, o título
    // "SOLICITAÇÃO DE PASSAGEM" saía em itálico). Bloco de altura 0: não ocupa
    // linha nem mexe na paginação, e acompanha o parágrafo se ele mudar de página.
    const dentro = anchor.closest<HTMLElement>("p");
    if (dentro) {
      dentro.parentElement?.insertBefore(anchor, dentro);
      anchor.style.display = "block";
      anchor.dataset.paragrafo = "1";
    }
    const a = offsetIn(anchor, page);
    if (!a) continue;
    const para =
      (anchor.dataset.paragrafo ? (anchor.nextElementSibling as HTMLElement | null) : null) ??
      anchor.parentElement ??
      anchor;
    const p = offsetIn(para, page) ?? a;
    const pad = { padLeft: px(pageCss?.paddingLeft ?? ""), padTop: px(pageCss?.paddingTop ?? "") };
    let left = horizontalOrigin(layer.dataset.hrel ?? "text", pad, a.x);
    let top = verticalOrigin(layer.dataset.vrel ?? "text", pad, p.y, a.y);
    // alinhamento (mso-position-horizontal: center/right…) no lugar do deslocamento
    const box = layer.firstElementChild as HTMLElement | null;
    const halign = layer.dataset.halign ?? "";
    if (box && /^(center|right)$/.test(halign)) {
      const larg = layer.dataset.hrel === "page" ? page.offsetWidth : page.clientWidth - pad.padLeft - px(pageCss?.paddingRight ?? "");
      left += (halign === "center" ? (larg - box.offsetWidth) / 2 : larg - box.offsetWidth) - box.offsetLeft;
    }
    const valign = layer.dataset.valign ?? "";
    if (box && /^(center|bottom)$/.test(valign) && layer.dataset.vrel === "page") {
      const alt = page.offsetHeight;
      top += (valign === "center" ? (alt - box.offsetHeight) / 2 : alt - box.offsetHeight) - box.offsetTop;
    }
    layer.style.left = `${left - a.x}px`;
    layer.style.top = `${top - a.y}px`;
    const presaNoTexto = !/^(page|margin|top-margin-area|bottom-margin-area)$/.test(layer.dataset.vrel ?? "text");
    if (box && layer.dataset.wrap === "topAndBottom" && presaNoTexto && para !== anchor) {
      // "acima e abaixo do texto": o texto do parágrafo não fica do lado da figura,
      // desce pra baixo dela (a lib desenhava a figura por cima do texto)
      const fundo = top + box.offsetTop + box.offsetHeight - p.y + px(layer.dataset.wrapb ?? "") * (4 / 3);
      reservas.set(para, Math.max(reservas.get(para) ?? 0, fundo));
    }
    n++;
  }
  // depois de posicionar tudo (idempotente: parte sempre do padding original)
  for (const [para, fundo] of reservas) {
    if (para.dataset.vmlPadOrig === undefined) para.dataset.vmlPadOrig = para.style.paddingTop;
    const orig = para.dataset.vmlPadOrig || "0px";
    para.style.paddingTop = fundo > 0 ? `calc(${orig} + ${fundo.toFixed(2)}px)` : orig;
  }
  return n;
}
