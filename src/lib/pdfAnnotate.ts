import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { passwordProtectedError } from "./pdfErrors";

/**
 * Anotações do viewer de PDF (modo lápis).
 *
 * Sistema de coordenadas: PONTOS PDF da página COMO EXIBIDA com origem no
 * TOPO-esquerda (mesma orientação do canvas/tela). Normalizamos ao criar —
 * coordenada CSS dividida pela escala CSS vigente da página — então zoom
 * durante a anotação não corrompe posições. Na EXPORTAÇÃO convertemos pro
 * espaço da PÁGINA do PDF (origem baixo-esquerda, y pra cima) levando em
 * conta o /Rotate: o viewport do pdf.js exibe a página já rotacionada, mas o
 * pdf-lib desenha no espaço sem rotação — ver displayedToPage.
 */
export type PdfAnnotation =
  | { kind: "text"; x: number; y: number; text: string; size: number; color: string }
  | { kind: "draw"; points: { x: number; y: number }[]; width: number; color: string }
  | { kind: "highlight"; x: number; y: number; w: number; h: number; color: string };

/** página (1-based) → anotações na ordem de criação */
export type AnnotationMap = Map<number, PdfAnnotation[]>;

export const HIGHLIGHT_ALPHA = 0.35;

/** "#rrggbb" → componentes 0–1 (formato do rgb() do pdf-lib). */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`cor inválida: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

/** Traço → path SVG ("M x,y L x,y …"); 1 ponto vira um tracinho (ponto visível). */
export function strokeToSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) throw new Error("traço sem pontos");
  const fmt = (v: number) => Number(v.toFixed(2));
  const [p0, ...rest] = points;
  const tail = rest.length > 0 ? rest : [{ x: p0.x + 0.1, y: p0.y }];
  return `M ${fmt(p0.x)},${fmt(p0.y)} ${tail.map((p) => `L ${fmt(p.x)},${fmt(p.y)}`).join(" ")}`;
}

/**
 * Pinta as anotações de UMA página num canvas overlay transparente.
 * `scale` = escala CSS da página (pt→px lógicos) e `pixelRatio` = resolução
 * física/CSS do canvas (DPR); o transform composto deixa o desenho direto em
 * coordenadas de página (pontos).
 */
export function paintAnnotations(
  canvas: HTMLCanvasElement,
  annots: PdfAnnotation[],
  scale: number,
  pixelRatio: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = scale * pixelRatio;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const a of annots) {
    if (a.kind === "highlight") {
      ctx.globalAlpha = HIGHLIGHT_ALPHA;
      ctx.fillStyle = a.color;
      ctx.fillRect(a.x, a.y, a.w, a.h);
      ctx.globalAlpha = 1;
    } else if (a.kind === "draw") {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const pts = a.points.length > 1 ? a.points : [a.points[0], { x: a.points[0].x + 0.1, y: a.points[0].y }];
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else {
      // mesmo modelo do PDF: (x, y) é o INÍCIO DA LINHA DE BASE do texto
      ctx.fillStyle = a.color;
      ctx.font = `${a.size}px Helvetica, Arial, sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(a.text, a.x, a.y);
    }
  }
}

/** Helvetica padrão só codifica WinAnsi — troca o que não cabe (emoji etc.) por "?". */
export const winAnsiSafe = (text: string): string =>
  [...text].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : "?")).join("");

/**
 * Espaço EXIBIDO → espaço da PÁGINA, compensando o /Rotate.
 *
 * Exibido: como o pdf.js mostra a página (rotação aplicada), origem
 * topo-esquerda, y pra baixo — pra /Rotate 90/270 a largura exibida é a
 * ALTURA real da página. Página: espaço em que o pdf-lib desenha, origem
 * baixo-esquerda, y pra cima, dimensões reais `w`×`h` (page.getSize()).
 * Derivação: /Rotate gira a página em sentido HORÁRIO na exibição; mapeamos
 * o ponto exibido de volta desfazendo o giro (validado empiricamente no
 * harness com /Rotate 90 e 270 — pixel do highlight sobre o marco visual).
 */
export function displayedToPage(
  x: number,
  y: number,
  rotation: number,
  w: number,
  h: number,
): { x: number; y: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: w - x, y };
    case 270:
      return { x: w - y, y: h - x };
    default:
      return { x, y: h - y };
  }
}

/**
 * Gera um NOVO PDF com as anotações desenhadas por cima do conteúdo original
 * (drawText/drawSvgPath/drawRectangle do pdf-lib — NÃO re-renderiza páginas
 * como imagem, então o texto original continua selecionável/extraível).
 */
export async function annotatePdf(
  bytes: Uint8Array,
  annots: AnnotationMap,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  // PDF cifrado (mesmo owner-only, que o viewer abre sem senha): o pdf-lib não
  // decifra — save sairia corrompido/erro críptico. Falha com mensagem clara.
  if (doc.isEncrypted) throw passwordProtectedError();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageCount = doc.getPageCount();
  for (const [pageNum, list] of annots) {
    if (list.length === 0) continue;
    if (pageNum < 1 || pageNum > pageCount) throw new Error(`página inválida: ${pageNum}`);
    const page = doc.getPage(pageNum - 1);
    const { width, height } = page.getSize();
    // /Rotate: o overlay capturou as coords no espaço EXIBIDO (rotacionado)
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const toPage = (x: number, y: number) => displayedToPage(x, y, rot, width, height);
    for (const a of list) {
      const { r, g, b } = hexToRgb01(a.color);
      const color = rgb(r, g, b);
      if (a.kind === "text") {
        // drawText posiciona pela linha de base — mesma âncora do overlay;
        // rotate acompanha o /Rotate pro texto ficar reto na VISUALIZAÇÃO
        const p = toPage(a.x, a.y);
        page.drawText(winAnsiSafe(a.text), {
          x: p.x,
          y: p.y,
          size: a.size,
          font,
          color,
          rotate: degrees(rot),
        });
      } else if (a.kind === "highlight") {
        // retângulo exibido → página: transforma 2 cantos opostos e re-deriva
        // (múltiplos de 90° preservam o alinhamento aos eixos)
        const p1 = toPage(a.x, a.y);
        const p2 = toPage(a.x + a.w, a.y + a.h);
        page.drawRectangle({
          x: Math.min(p1.x, p2.x),
          y: Math.min(p1.y, p2.y),
          width: Math.abs(p2.x - p1.x),
          height: Math.abs(p2.y - p1.y),
          color,
          opacity: HIGHLIGHT_ALPHA,
        });
      } else {
        // drawSvgPath interpreta o path com Y crescendo pra BAIXO a partir de
        // (x, y) — ancorando em (0, height) o path fica em coords de página
        // topo-esquerda; cada ponto é transformado exibido → página antes
        const pts = a.points.map((p) => {
          const q = toPage(p.x, p.y);
          return { x: q.x, y: height - q.y };
        });
        page.drawSvgPath(strokeToSvgPath(pts), {
          x: 0,
          y: height,
          borderColor: color,
          borderWidth: a.width,
          borderLineCap: LineCapStyle.Round,
        });
      }
    }
  }
  return doc.save();
}
