/**
 * Matemática do zoom do viewer — funções puras (sem DOM, sem pdf.js) pra
 * poderem ser testadas em Node.
 */

/** Maior dimensão física permitida por canvas — zoom alto × DPR estoura o
 *  limite de canvas/memória da WebView Android. */
export const MAX_CANVAS_DIM = 4096;

/**
 * Teto de pixels FÍSICOS por página no viewer (~6 MP ≈ 24 MB de bitmap).
 * Sem ele, zoom 3× num celular DPR 3 gerava canvases de ~14 MP (55 MB) por
 * página — o re-render travava a tela e a soma das páginas vivas estourava a
 * memória do compositor (tela em branco / conteúdo duplicado na pinça).
 * A nitidez cai pouco: em zoom alto o texto já está 2–3× maior, então ~1,7 px
 * físicos por px CSS continua legível.
 */
export const VIEWER_MAX_CANVAS_PIXELS = 6_000_000;

/** Orçamento de pixels físicos somados de TODAS as páginas vivas (~40 MP ≈
 *  160 MB). Acima disso as páginas longe do viewport viram placeholder. */
export const LIVE_PIXEL_BUDGET = 40_000_000;

export interface RatioLimits {
  dim?: number; // maior dimensão física (px)
  pixels?: number; // total de pixels físicos
}

/**
 * Px físicos por px CSS pra um canvas de cssW×cssH: o DPR pedido, limitado
 * pela maior dimensão e (opcionalmente) pelo total de pixels.
 */
export function physicalRatio(
  cssW: number,
  cssH: number,
  dpr: number,
  limits: RatioLimits = {},
): number {
  const dim = limits.dim ?? MAX_CANVAS_DIM;
  const byDim = dim / Math.max(cssW, cssH);
  const byPixels =
    limits.pixels === undefined ? Infinity : Math.sqrt(limits.pixels / (cssW * cssH));
  return Math.min(dpr, byDim, byPixels);
}

/** Retângulo na tela (o DOMRect da página serve). */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Ponto (x, y) da tela como fração da página `r` (0–1 dentro dela). */
export const toPageFraction = (x: number, y: number, r: ScreenRect) => ({
  rx: (x - r.left) / r.width,
  ry: (y - r.top) / r.height,
});

/**
 * Quanto rolar (dx, dy) pra fração (rx, ry) da página, medida no layout NOVO
 * (`r`, depois do zoom), parar em (x, y) na tela — o ponto focal da pinça fica
 * debaixo dos dedos. Medir a página de novo é o que acerta: uma conta
 * proporcional ao container erra pelo que não escala junto (padding, vão entre
 * páginas, margem que centraliza a página menor que a tela).
 */
export const scrollToFraction = (
  a: { rx: number; ry: number; x: number; y: number },
  r: ScreenRect,
) => ({
  dx: r.left + a.rx * r.width - a.x,
  dy: r.top + a.ry * r.height - a.y,
});

/** Fator do gesto (dist atual / inicial) limitado pra que a escala FINAL
 *  (zoomInicial × g) fique dentro de [min, max]. */
export const clampGesture = (raw: number, startZoom: number, min: number, max: number): number =>
  Math.min(max / startZoom, Math.max(min / startZoom, raw));

/**
 * Posição que a página deve ocupar no PREVIEW num eixo, dada a posição livre
 * (`pos`) que o gesto pediu: se a página escalada cabe na área visível, fica
 * centralizada (é onde mx-auto/m-auto vão pô-la ao comitar); se não cabe, não
 * pode abrir vão em nenhuma borda (igual a um scroll clampado). Assim o soltar
 * cai exatamente onde o preview já estava — sem pulo nem tarja de fundo.
 */
export const clampPreview = (
  pos: number,
  size: number,
  areaPos: number,
  areaSize: number,
  center = true, // cabe → centralizado (m-auto); false → alinhado ao início
): number =>
  size <= areaSize
    ? areaPos + (center ? (areaSize - size) / 2 : 0)
    : Math.min(areaPos, Math.max(areaPos + areaSize - size, pos));

/** Ponto `p` depois de escalar por `g` em torno da origem `o` (mesmo eixo). */
export const scaleAbout = (p: number, o: number, g: number): number => o + (p - o) * g;
