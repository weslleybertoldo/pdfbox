/**
 * Links clicáveis do PDF (anotações /Link): mapeia as anotações de uma página
 * pra alvos posicionados em % do box da página e monta a camada de <a>.
 *
 * Só funções puras/DOM aqui — NADA de pdf.js em runtime (tipos apenas), pra
 * os testes rodarem em Node sem o worker. Quem chama:
 *   - `linkTargets(await page.getAnnotations({ intent: "display" }), viewport)`
 *   - `buildLinkLayer(targets, { onUrl, onDest })` → append no box da página
 *   - `resolvePageNumber(doc, dest)` pra link interno → número da página
 *
 * Posições em % (não px): o double-buffer do zoom estica o box via CSS e a
 * camada acompanha sozinha, sem recalcular nada.
 */

/** Retângulo em % do box da página. */
export interface PctRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type LinkTarget =
  | { kind: "url"; url: string; rect: PctRect }
  | { kind: "dest"; dest: string | unknown[]; rect: PctRect };

/** Subconjunto da PageViewport do pdf.js que usamos (testável com fake):
 *  `transform` é a matriz [a b c d e f] PDF → CSS (escala, rotação, eixo y
 *  invertido) — o pdf.js 6 não expõe mais convertToViewportRectangle. */
export interface ViewportLike {
  width: number;
  height: number;
  transform: number[];
}

/** Aplica a matriz do viewport a um ponto do espaço do PDF. */
const toViewport = (m: number[], x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** Subconjunto do PDFDocumentProxy usado pra resolver destinos internos. */
export interface DocLike {
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: object): Promise<number>;
}

/** Esquemas que o viewer abre fora do app. `javascript:`/`file:`/`data:` etc.
 *  ficam de fora — PDF de terceiro não pode rodar nada dentro da WebView. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function isSafeUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol.toLowerCase());
  } catch {
    return false; // relativa/inválida: sem base pra resolver → não abre
  }
}

interface LinkAnnot {
  subtype?: string;
  rect?: number[];
  url?: unknown;
  unsafeUrl?: unknown;
  dest?: unknown;
}

/** Anotações /Link da página → alvos em % (ignora rects degenerados e ações
 *  que não são URL nem destino interno — JavaScript, Launch, GoToR…). */
export function linkTargets(annots: unknown[], viewport: ViewportLike): LinkTarget[] {
  const out: LinkTarget[] = [];
  for (const raw of annots) {
    const a = raw as LinkAnnot | null;
    if (!a || a.subtype !== "Link" || !Array.isArray(a.rect) || a.rect.length !== 4) continue;
    if (!Array.isArray(viewport.transform) || viewport.transform.length < 6) continue;
    const [x1, y1] = toViewport(viewport.transform, a.rect[0], a.rect[1]);
    const [x2, y2] = toViewport(viewport.transform, a.rect[2], a.rect[3]);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    if (width < 1 || height < 1 || viewport.width <= 0 || viewport.height <= 0) continue;
    const rect: PctRect = {
      left: (left / viewport.width) * 100,
      top: (top / viewport.height) * 100,
      width: (width / viewport.width) * 100,
      height: (height / viewport.height) * 100,
    };
    // pdf.js só preenche `url` quando é absoluta e válida; `unsafeUrl` é o cru
    const url = isSafeUrl(a.url) ? a.url : isSafeUrl(a.unsafeUrl) ? a.unsafeUrl : null;
    if (url) {
      out.push({ kind: "url", url, rect });
    } else if (typeof a.dest === "string" || Array.isArray(a.dest)) {
      out.push({ kind: "dest", dest: a.dest, rect });
    }
  }
  return out;
}

/**
 * Destino interno → número da página (1-based) ou null se não der pra
 * resolver. Destino nomeado vira array via getDestination; o 1º item do
 * array é uma Ref ({num, gen}) da página ou, em alguns PDFs, o índice.
 */
export async function resolvePageNumber(
  doc: DocLike,
  dest: string | unknown[],
): Promise<number | null> {
  try {
    const arr = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const ref = arr[0];
    if (typeof ref === "number" && Number.isInteger(ref) && ref >= 0) return ref + 1;
    if (ref && typeof ref === "object" && "num" in ref) return (await doc.getPageIndex(ref)) + 1;
    return null;
  } catch {
    return null;
  }
}

export interface LinkHandlers {
  onUrl: (url: string) => void;
  onDest: (dest: string | unknown[]) => void;
}

const pct = (n: number) => `${n}%`;

/** Camada `.linkLayer` com um <a> por alvo (CSS em index.css). */
export function buildLinkLayer(targets: LinkTarget[], handlers: LinkHandlers): HTMLDivElement {
  const layer = document.createElement("div");
  layer.className = "linkLayer";
  for (const t of targets) {
    const a = document.createElement("a");
    a.style.left = pct(t.rect.left);
    a.style.top = pct(t.rect.top);
    a.style.width = pct(t.rect.width);
    a.style.height = pct(t.rect.height);
    a.dataset.linkKind = t.kind;
    if (t.kind === "url") {
      a.href = t.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = t.url;
      a.setAttribute("aria-label", `Abrir ${t.url}`);
      a.addEventListener("click", (e) => {
        e.preventDefault(); // quem abre é o app (Custom Tab no Android)
        handlers.onUrl(t.url);
      });
    } else {
      a.href = "#";
      a.setAttribute("role", "button");
      a.setAttribute("aria-label", "Ir para a página do link");
      const dest = t.dest;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        handlers.onDest(dest);
      });
    }
    layer.appendChild(a);
  }
  return layer;
}
