import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeft, Bold, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Download, Hand, Highlighter, Italic, LayoutGrid, List, LockOpen, Pencil, PenLine,
  ScrollText, Search, Share2, Type, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { pickFiles, DOCX_MIME, isDocxFile } from "../lib/files";
import { saveToDevice } from "../lib/mediaSaver";
import {
  loadPdf,
  startPageRender,
  isRenderCancelled,
  renderTextLayer,
  destroyPdf,
  getTextLayerDivs,
  isPasswordError,
  isWrongPasswordError,
  type PdfDoc,
} from "../lib/pdfRender";
import { buildLinkLayer, linkTargets, resolvePageNumber } from "../lib/pdfLinks";
import { openExternalLink } from "../lib/openLink";
import {
  clampGesture, clampPreview, scaleAbout, scrollToFraction, toPageFraction,
  LIVE_PIXEL_BUDGET, VIEWER_MAX_CANVAS_PIXELS,
} from "../lib/zoomMath";
import { unlockPdf, unlockedName } from "../lib/pdfUnlock";
import { searchPdf, type PageIndex, type SearchMatch } from "../lib/pdfSearch";
import {
  buildText, findMatches, normalizeForSearch, splitMatch, type Piece,
} from "../lib/textSearch";
import {
  clearSearchHighlights, rangeOver, scrollToRange, setSearchHighlights,
} from "../lib/searchHighlight";
import {
  annotatePdf,
  paintAnnotations,
  type AnnotationMap,
  type PdfAnnotation,
} from "../lib/pdfAnnotate";
import { consumeOpenFile } from "../lib/openFileStore";
import { addRecent } from "../lib/recents";
import { docxToHtml } from "../lib/convert/docxToPdf";
import { sanitizeHtml } from "../lib/convert/htmlPipeline";
import { editedDomToDocx } from "../lib/convert/htmlToDocx";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import RecentsButton from "../components/RecentsButton";
import ShareMenu from "../components/ShareMenu";
import ActionsMenu, { type ViewerFileKind } from "../components/ActionsMenu";
import DiscoverPassword from "../components/DiscoverPassword";
import DocxView from "../components/DocxView";
import { prepareDocx, type PreparedDocx } from "../lib/docx/render";

/** Botão da toolbar de edição: preventDefault no mousedown preserva a seleção. */
const ToolBtn = ({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className="min-w-[36px] px-2.5 py-1.5 bg-slate-800 rounded text-xs font-medium flex items-center justify-center"
  >
    {children}
  </button>
);

/** Botão da barra inferior do viewer: ícone + legenda, fração igual da largura. */
const BarBtn = ({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    data-bar-btn={label}
    className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-slate-300 active:text-blue-400 disabled:opacity-40"
  >
    {children}
    <span className="text-[10px] leading-none">{label}</span>
  </button>
);

/** Elementos de BLOCO das páginas do Word (fronteira de texto na busca). */
const DOCX_BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote, div";

/** Nós de texto (não vazios) sob root, em ordem de documento — busca no Word. */
const collectTextNodes = (root: HTMLElement): Text[] => {
  const out: Text[] = [];
  // o CSS da docx-preview mora num <style> dentro do DocxView: fora da busca
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data.length > 0) out.push(n as Text);
  }
  return out;
};

// ── Modo anotação de PDF ─────────────────────────────────────────────────────
// Anotações vivem em ESTADO por página (annotsRef), em PONTOS PDF com origem
// topo-esquerda (normalizadas pela escala CSS ao criar) — zoom no meio da
// anotação não corrompe posições e a virtualização pode descartar/recriar o
// overlay sem perder nada. Desfazer = stack GLOBAL (última anotação criada,
// em qualquer página). Scroll durante a anotação: ferramenta "Mão" (overlay
// vira pointer-events:none); com Texto/Desenho/Marca-texto, 1 dedo é a
// ferramenta (touch-action:none no overlay) e um 2º dedo CANCELA o traço em
// andamento; pinch fica desligado (zoom pelos botões do header).
type AnnotTool = "text" | "draw" | "highlight" | "hand";
const ANNOT_COLORS: { hex: string; nome: string }[] = [
  { hex: "#facc15", nome: "amarelo" },
  { hex: "#ef4444", nome: "vermelho" },
  { hex: "#3b82f6", nome: "azul" },
  { hex: "#000000", nome: "preto" },
];
const DRAW_PX = 3; // largura do traço em px lógicos na escala de criação
const TEXT_SIZE_PT = 14; // caixa de texto: tamanho em pontos PDF (proporcional à página)
/** Limite físico de canvas da WebView (mesmo racional do MAX_CANVAS_DIM do render). */
const OVERLAY_MAX_DIM = 4096;

/** Botão da toolbar de anotação (com estado ativo/desabilitado). */
const AnnotBtn = ({ label, active, disabled, onClick, children }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={`min-w-[36px] px-2.5 py-1.5 rounded text-xs font-medium flex items-center justify-center ${
      active ? "bg-blue-600" : "bg-slate-800"
    } ${disabled ? "opacity-40" : ""}`}
  >
    {children}
  </button>
);

// ── Modo livro ───────────────────────────────────────────────────────────────
// UMA página por vez ocupando a área útil: swipe pra esquerda avança, pra
// direita volta (1 dedo, movimento predominantemente horizontal, ≥60px).
// Zoom (botões e pinch) re-renderiza a página na escala nova, com scroll
// INTERNO do container quando ela fica maior que a tela. A escolha do modo
// persiste em localStorage. Anotação FUNCIONA no modo livro (overlay na
// página exibida); durante a anotação o swipe fica desligado (1 dedo é a
// ferramenta) — a navegação é pelos botões ‹ › do indicador "X/Y".
type ViewMode = "continuous" | "book";
const VIEWER_MODE_KEY = "viewerMode";
const SWIPE_MIN_PX = 60;

// ── Duplo-toque ──────────────────────────────────────────────────────────────
const DBLTAP_MS = 300; // janela máx entre os 2 taps
const DBLTAP_DIST = 30; // distância máx entre os 2 taps
const TAP_SLOP = 12; // movimento máx dentro de um tap
const TAP_MAX_MS = 250; // duração máx de um tap (long-press não conta)
const DBLTAP_ZOOM = 2; // alvo do duplo-toque quando zoom == 1
const DBLTAP_ANIM_MS = 160;

/** Zera os backing stores de todos os canvases sob root (libera memória já). */
const releaseCanvases = (root: ParentNode) => {
  root.querySelectorAll("canvas").forEach((cv) => {
    cv.width = 0;
    cv.height = 0;
  });
};

/**
 * Double-buffer do zoom: estica o conteúdo ANTIGO do box pra escala nova via
 * CSS (bitmap fica borrado mas VISÍVEL) até o render novo trocar o box inteiro
 * de forma atômica — sem nenhum frame de tela vazia entre o zoom e o re-render.
 * dataset.scale (box e overlay) acompanha pra coordenadas de anotação e
 * repaint continuarem consistentes durante a janela; o --scale-factor do text
 * layer idem (spans invisíveis; o layer é recriado no swap).
 */
const stretchBox = (box: HTMLElement, ratio: number) => {
  const scalePx = (el: HTMLElement) => {
    el.style.width = `${parseFloat(el.style.width) * ratio}px`;
    el.style.height = `${parseFloat(el.style.height) * ratio}px`;
  };
  scalePx(box);
  if (box.dataset.scale) box.dataset.scale = String(Number(box.dataset.scale) * ratio);
  box.querySelectorAll<HTMLCanvasElement>("canvas").forEach((cv) => {
    scalePx(cv);
    if (cv.dataset.annotPage && box.dataset.scale) cv.dataset.scale = box.dataset.scale;
  });
  const text = box.querySelector<HTMLElement>(".textLayer");
  if (text) {
    const sf = parseFloat(text.style.getPropertyValue("--scale-factor"));
    if (sf) text.style.setProperty("--scale-factor", String(sf * ratio));
  }
};

/**
 * Stage = filho único do container (viewport/scroller) que segura as páginas e
 * recebe o transform do preview da pinça/duplo-toque. Escalar o STAGE — e não o
 * viewport — é o que faz o zoom-out mostrar só o gutter do app em volta da
 * página (igual ao estado comitado) em vez de encolher a tela inteira e expor
 * uma tarja preta lateral (defeito visto no aparelho, 18/09/2026). O stage é o
 * item flex-1 do container e herda o papel de layout que as páginas esperavam
 * do container (flex-col no contínuo; flex no livro, pro m-auto centralizar).
 * `w-max`/`h-max` (+ min 100%): o box de LAYOUT do stage cobre o conteúdo
 * inteiro — o transform do preview não muda layout, então a área rolável do
 * container não encolhe no meio do gesto (senão o Chrome recorta scrollLeft/
 * scrollTop enquanto a página encolhe e o conteúdo escapa dos dedos).
 */
const STAGE_CLASS: Record<ViewMode, string> = {
  continuous: "flex-1 flex flex-col min-w-full w-max",
  book: "flex-1 flex min-h-full h-max",
};
const getStage = (container: HTMLElement, mode: ViewMode): HTMLElement => {
  let stage = container.querySelector<HTMLElement>(":scope > [data-stage]");
  if (!stage) {
    stage = document.createElement("div");
    stage.dataset.stage = "";
    container.replaceChildren(stage);
  }
  stage.className = STAGE_CLASS[mode];
  return stage;
};
/** Quem recebe o transform do preview (o stage; o container se ainda não há). */
const previewTarget = (container: HTMLElement): HTMLElement =>
  container.querySelector<HTMLElement>(":scope > [data-stage]") ?? container;
const clearPreview = (el: HTMLElement) => {
  el.style.transform = "";
  el.style.transformOrigin = "";
  el.style.willChange = "";
};

/**
 * Ponto focal da pinça/duplo-toque ANCORADO NA PÁGINA: a fração (rx, ry) da
 * página `page` que tem que parar na tela em (x, y) quando o zoom novo entrar
 * no layout. O efeito de render mede a página de novo depois de esticar e rola
 * a diferença — a conta proporcional ao container errava pelo que não escala
 * (p-2, mb-2 entre páginas, my-auto/m-auto da página menor que a tela): na
 * logo do ofício de 1 página eram ~200 px ("quando solto ele desce", 23/09/2026).
 */
type FocusAnchor = { page: string; rx: number; ry: number; x: number; y: number };
/** Rect da página: o box desenhado ou, sem ele (placeholder), o wrapper. */
const pageRect = (wrapper: HTMLElement): DOMRect =>
  (wrapper.querySelector<HTMLElement>("[data-annot-box]") ?? wrapper).getBoundingClientRect();
/** Âncora do ponto (x, y) na página sob ele (ou na mais perto, na vertical). */
const anchorAt = (container: HTMLElement, x: number, y: number): FocusAnchor | null => {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const w of container.querySelectorAll<HTMLElement>("[data-page]")) {
    const r = w.getBoundingClientRect();
    const d = Math.max(r.top - y, y - r.bottom, 0);
    if (d < bestDist) {
      bestDist = d;
      best = w;
    }
    if (d === 0) break;
  }
  if (!best) return null;
  const r = pageRect(best);
  if (!r.width || !r.height) return null;
  return { page: best.dataset.page ?? "", ...toPageFraction(x, y, r), x, y };
};
/** Rola até o ponto ancorado parar em (x, y): horizontal no container,
 *  vertical em `scrollY` (documento no contínuo, o próprio container no livro). */
const scrollToAnchor = (container: HTMLElement, scrollY: Element, a: FocusAnchor) => {
  const w = container.querySelector<HTMLElement>(`[data-page="${a.page}"]`);
  if (!w) return;
  const { dx, dy } = scrollToFraction(a, pageRect(w));
  container.scrollLeft += dx;
  scrollY.scrollTop += dy;
};

/**
 * Encaixe do preview de zoom (pinça e duplo-toque), medido no início do gesto:
 * o preview vai pra onde o layout comitado vai pôr a página — menor que a
 * área útil fica centralizada, maior não abre vão nas bordas —, então soltar
 * não pula (e o zoom-out nunca mostra o fundo numa tarja).
 */
type PreviewFit = {
  box: DOMRect | null; // 1ª página desenhada (largura; e altura no livro)
  // coluna de páginas no contínuo (topo da 1ª ao fim da última) — NÃO o stage:
  // ele é flex-1 e, com 1 página menor que a tela, sobra acima e abaixo dela
  // (my-auto); clampar o stage deixava o preview abrir um vão acima da página
  // que o layout comitado não tem, e o soltar pulava (23/09/2026)
  column: { top: number; height: number } | null;
  x: { pos: number; size: number }; // área útil horizontal (container)
  y: { pos: number; size: number }; // vertical: container (livro); header → barra inferior (contínuo)
  book: boolean;
  center: boolean; // o que cabe centraliza: sempre no livro; no contínuo só 1 página (my-auto)
};
const PREVIEW_PAD = 8; // p-2 do container
const measurePreviewFit = (
  container: HTMLElement,
  stage: HTMLElement,
  book: boolean,
  onePage: boolean,
): PreviewFit => {
  const rect = container.getBoundingClientRect();
  const pages = stage.querySelectorAll<HTMLElement>(":scope > [data-page]");
  const first = pages[0]?.getBoundingClientRect();
  const last = pages[pages.length - 1]?.getBoundingClientRect();
  let y = { pos: rect.top + PREVIEW_PAD, size: container.clientHeight - 2 * PREVIEW_PAD };
  if (!book) {
    // contínuo: quem rola é o documento; a borda de cima é o header sticky
    // (ou o container, se ainda está abaixo dele) e a de baixo, a barra inferior
    const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const barTop =
      document.querySelector("[data-bottom-bar]")?.getBoundingClientRect().top ?? window.innerHeight;
    const top = Math.max(rect.top, headerBottom) + PREVIEW_PAD;
    y = { pos: top, size: Math.max(0, Math.min(window.innerHeight, barTop) - PREVIEW_PAD - top) };
  }
  return {
    box: container.querySelector<HTMLElement>("[data-annot-box]")?.getBoundingClientRect() ?? null,
    column: first && last ? { top: first.top, height: last.bottom - first.top } : null,
    x: { pos: rect.left + PREVIEW_PAD, size: container.clientWidth - 2 * PREVIEW_PAD },
    y,
    book,
    center: book || onePage,
  };
};
/** Deslocamento (sx, sy) do preview na escala g em torno de (ox, oy), já encaixado. */
const fitPreview = (f: PreviewFit, g: number, ox: number, oy: number, sx: number, sy: number) => {
  if (!f.box) return { x: sx, y: sy };
  const left = scaleAbout(f.box.left, ox, g) + sx;
  sx += clampPreview(left, f.box.width * g, f.x.pos, f.x.size) - left;
  const col = f.book ? { top: f.box.top, height: f.box.height } : f.column;
  if (col) {
    const top = scaleAbout(col.top, oy, g) + sy;
    sy += clampPreview(top, col.height * g, f.y.pos, f.y.size, f.center) - top;
  }
  return { x: sx, y: sy };
};

const Viewer = () => {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null); // p/ compartilhar
  const [name, setName] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null); // modo imagem
  const [docxDoc, setDocxDoc] = useState<PreparedDocx | null>(null); // modo Word (fiel, docx-preview)
  const [editHtml, setEditHtml] = useState<string | null>(null); // HTML do mammoth, só durante a edição
  const [editing, setEditing] = useState(false); // modo docx: contentEditable ligado
  const [result, setResult] = useState<ResultFile[] | null>(null); // .docx salvo da edição
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEWER_MODE_KEY) === "book" ? "book" : "continuous",
  );
  const [bookPage, setBookPage] = useState(1); // página atual do modo livro (1-based)
  const containerRef = useRef<HTMLDivElement>(null);
  const docxRef = useRef<HTMLDivElement>(null); // scroller do DocxView (busca + scroll horizontal)
  const editRef = useRef<HTMLDivElement>(null); // contentEditable do editor
  const zoomRef = useRef(zoom); // valor atual pro handler de pinch (efeito só depende de doc)
  const pendingFocusRef = useRef<FocusAnchor | null>(null); // ponto focal da pinça/duplo-toque, aplicado no re-render
  const pendingScrollPageRef = useRef<number | null>(null); // livro→contínuo: rolar até a página
  // double-buffer do zoom: estado do último render comitado + posse do container
  // (o cleanup só limpa o DOM de verdade se nenhum efeito assumir no mesmo commit)
  const lastRenderRef = useRef<{ doc: PdfDoc; mode: ViewMode; zoom: number; page: number } | null>(null);
  const claimRef = useRef(false);
  const location = useLocation();
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const bookPageRef = useRef(bookPage);
  bookPageRef.current = bookPage;
  useEffect(() => {
    localStorage.setItem(VIEWER_MODE_KEY, viewMode);
  }, [viewMode]);
  // pinça em andamento → o pump de render espera o dedo soltar (render no meio
  // do gesto rouba a thread principal e o preview engasga); pumpRef retoma
  const gestureRef = useRef(false);
  const pumpRef = useRef<() => void>(() => {});

  type PdfPage = Awaited<ReturnType<PdfDoc["getPage"]>>;
  type PdfViewport = ReturnType<PdfPage["getViewport"]>;

  /** Rola o contínuo até o topo da página n (48 ≈ header sticky) ou troca a
   *  página do livro — destino dos links internos do PDF. */
  const goToPage = (n: number) => {
    if (!doc || n < 1 || n > doc.numPages) return;
    if (viewModeRef.current === "book") {
      setBookPage(n);
      return;
    }
    const target = containerRef.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    const scroller = document.scrollingElement;
    if (!target || !scroller) return;
    scroller.scrollTop = Math.max(0, target.getBoundingClientRect().top + scroller.scrollTop - 48);
  };
  // handlers dos <a> da camada de links, lidos via ref: as páginas são
  // montadas imperativamente e vivem mais que um render do React
  const linkHandlersRef = useRef({
    onUrl: (_url: string) => {},
    onDest: (_dest: string | unknown[]) => {},
  });
  linkHandlersRef.current = {
    onUrl: (url) => void openExternalLink(url),
    onDest: (dest) => {
      if (!doc) return;
      void resolvePageNumber(doc, dest).then((n) => {
        if (n) goToPage(n);
        else toast.error("Destino do link não encontrado neste PDF");
      });
    },
  };
  /** Monta a camada de links da página dentro do box (assíncrono: lê as
   *  anotações no worker; se o box já saiu do DOM, não faz nada). */
  const attachLinks = async (page: PdfPage, viewport: PdfViewport, box: HTMLElement) => {
    try {
      const annots = await page.getAnnotations({ intent: "display" });
      if (!box.isConnected) return;
      const targets = linkTargets(annots, viewport);
      if (targets.length === 0) return;
      box.appendChild(
        buildLinkLayer(targets, {
          onUrl: (u) => linkHandlersRef.current.onUrl(u),
          onDest: (d) => linkHandlersRef.current.onDest(d),
        }),
      );
    } catch {
      // anotações ilegíveis/doc destruído no meio: página segue sem links
    }
  };

  /** Página mais visível no viewport (contínuo) ou a do livro. */
  const mostVisiblePage = () => {
    if (viewModeRef.current === "book") return bookPageRef.current;
    const wrappers = containerRef.current?.querySelectorAll<HTMLElement>("[data-page]");
    let best = 1;
    let bestVis = -Infinity;
    wrappers?.forEach((w) => {
      const r = w.getBoundingClientRect();
      const vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (vis > bestVis) {
        bestVis = vis;
        best = Number(w.dataset.page) || 1;
      }
    });
    return best;
  };

  /** Toggle contínuo↔livro preservando a página atual. */
  const toggleViewMode = () => {
    if (viewMode === "continuous") {
      // página mais visível no viewport vira a página do livro
      setBookPage(mostVisiblePage());
      setViewMode("book");
    } else {
      pendingScrollPageRef.current = bookPage;
      setViewMode("continuous");
    }
  };

  // ── estado do modo anotação (ver comentário acima do componente) ────────
  const [annotating, setAnnotating] = useState(false);
  const [tool, setTool] = useState<AnnotTool>("draw");
  const [color, setColor] = useState<string>(ANNOT_COLORS[0].hex);
  const [annotCount, setAnnotCount] = useState(0); // total → repaint + habilita Desfazer
  const [textDraft, setTextDraft] = useState<
    { page: number; xPt: number; yPt: number; left: number; top: number } | null
  >(null);
  const [textValue, setTextValue] = useState("");
  const annotsRef = useRef<AnnotationMap>(new Map());
  const undoRef = useRef<number[]>([]); // páginas na ordem de criação (stack global)
  const pdfWrapRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  // refs lidas por handlers/efeitos que não re-anexam a cada render
  const annotatingRef = useRef(annotating);
  annotatingRef.current = annotating;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const draftOpenRef = useRef(false);
  draftOpenRef.current = textDraft !== null;
  const confirmDraftRef = useRef<() => void>(() => {});

  /** Redesenha um overlay a partir do estado (fonte da verdade: annotsRef). */
  const repaintOverlay = (cv: HTMLCanvasElement) => {
    const page = Number(cv.dataset.annotPage);
    const scale = Number(cv.dataset.scale);
    const ratio = cv.width / parseFloat(cv.style.width);
    paintAnnotations(cv, annotsRef.current.get(page) ?? [], scale, ratio);
  };

  /** Cria (se preciso) o canvas overlay transparente sobre o box da página. */
  const ensureOverlay = (box: HTMLElement) => {
    let cv = box.querySelector<HTMLCanvasElement>("canvas[data-annot-page]");
    if (cv) return cv;
    const cssW = parseFloat(box.style.width);
    const cssH = parseFloat(box.style.height);
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      OVERLAY_MAX_DIM / Math.max(cssW, cssH),
    );
    cv = document.createElement("canvas");
    cv.dataset.annotPage = box.dataset.annotBox;
    cv.dataset.scale = box.dataset.scale;
    cv.width = Math.floor(cssW * ratio);
    cv.height = Math.floor(cssH * ratio);
    cv.className = "absolute inset-0";
    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssH}px`;
    // acima do textLayer (1) e da camada de links (2): anotando, o toque
    // nunca abre um link do PDF
    cv.style.zIndex = "3";
    cv.style.touchAction = "none"; // 1 dedo = ferramenta (sem scroll nativo no overlay)
    cv.style.pointerEvents = toolRef.current === "hand" ? "none" : "auto";
    box.appendChild(cv);
    repaintOverlay(cv);
    return cv;
  };

  const commitAnnot = (page: number, a: PdfAnnotation) => {
    const list = annotsRef.current.get(page) ?? [];
    list.push(a);
    annotsRef.current.set(page, list);
    undoRef.current.push(page);
    setAnnotCount((c) => c + 1);
  };

  const undoAnnot = () => {
    const page = undoRef.current.pop();
    if (page === undefined) return;
    annotsRef.current.get(page)?.pop();
    setAnnotCount((c) => c - 1);
  };

  const startAnnotating = () => {
    setResult(null);
    setTool("draw");
    setColor(ANNOT_COLORS[0].hex);
    setAnnotating(true);
  };

  /** Cancelar/pós-salvar: descarta as anotações e volta ao modo leitura. */
  const exitAnnotating = () => {
    annotsRef.current = new Map();
    undoRef.current = [];
    setAnnotCount(0);
    setTextDraft(null);
    setTextValue("");
    setAnnotating(false);
  };

  /** Confirma a caixa de texto flutuante (vira anotação na posição do tap). */
  const confirmTextDraft = () => {
    if (!textDraft) return;
    const t = textValue.trim();
    if (t) {
      commitAnnot(textDraft.page, {
        kind: "text", x: textDraft.xPt, y: textDraft.yPt, text: t,
        size: TEXT_SIZE_PT, color,
      });
    }
    setTextDraft(null);
    setTextValue("");
  };
  confirmDraftRef.current = confirmTextDraft;

  /** Salvar: NOVO PDF com as anotações achatadas por cima do original. */
  const saveAnnotations = async () => {
    if (!blob) return;
    if (textDraft && textValue.trim()) confirmTextDraft(); // commit é síncrono no ref
    if (undoRef.current.length === 0) {
      toast.info("Nenhuma anotação para salvar");
      return;
    }
    try {
      const out = await annotatePdf(new Uint8Array(await blob.arrayBuffer()), annotsRef.current);
      const base = (name ?? "documento").replace(/\.pdf$/i, "");
      setResult([{
        blob: new Blob([out.slice()], { type: "application/pdf" }),
        name: `${base}-anotado.pdf`,
        collection: "downloads",
      }]);
      exitAnnotating();
    } catch (e) {
      toast.error(`Erro ao salvar: ${e instanceof Error ? e.message : e}`);
    }
  };

  /**
   * Abre bytes de qualquer origem (picker, intent externo, ResultPanel).
   * ATÔMICO: parseia PRIMEIRO (sem tocar em nenhum estado) e só comita a
   * troca com o parse ok — bytes corrompidos rejeitam AQUI e o arquivo
   * anterior (header, conteúdo, Compartilhar, anotações) fica 100% intacto.
   */
  const openBytes = async (
    bytes: Uint8Array,
    fileName: string,
    mimeType: string,
    password?: string,
  ) => {
    // .slice() garante Uint8Array<ArrayBuffer> (BlobPart) e evita o detach
    // do buffer pelo worker do pdf.js (loadPdf também copia internamente)
    const b = new Blob([bytes.slice()], { type: mimeType });
    let next: { doc: PdfDoc | null; docxDoc: PreparedDocx | null; imgUrl: string | null };
    if (isDocxFile(fileName, mimeType)) {
      // prepara e valida ANTES de trocar o que está na tela (abrir é atômico)
      let prepared: PreparedDocx;
      try {
        prepared = await prepareDocx(bytes);
      } catch {
        throw new Error("não foi possível abrir este Word");
      }
      next = { doc: null, imgUrl: null, docxDoc: prepared };
    } else if (mimeType.startsWith("image/")) {
      next = { doc: null, docxDoc: null, imgUrl: URL.createObjectURL(b) };
    } else {
      next = { imgUrl: null, docxDoc: null, doc: await loadPdf(bytes, password) };
    }
    // ── commit (parse ok): os efeitos de cleanup destroem o doc antigo
    // (destroyPdf) e revogam o imgUrl antigo quando doc/imgUrl mudam
    setName(fileName);
    setBlob(b);
    setZoom(1);
    setBookPage(1); // arquivo novo começa na 1ª página (modo livro persiste)
    setEditing(false);
    setResult(null);
    exitAnnotating(); // troca de arquivo descarta anotações em andamento
    setDoc(next.doc);
    setDocxDoc(next.docxDoc);
    setEditHtml(null);
    setImgUrl(next.imgUrl);
    // abriu com sucesso (qualquer origem) → registra no histórico do viewer
    void addRecent("viewer", { name: fileName, mime: mimeType, blob: b });
  };

  // ── PDF protegido por senha ──────────────────────────────────────────────
  // loadPdf rejeita com PasswordException → dialog pede a senha e re-tenta o
  // MESMO openBytes com ela (bytes ficam guardados no estado do dialog).
  // Senha errada (code 2) reabre o dialog com a mensagem de erro; Cancelar
  // descarta tudo — openBytes é atômico, então o arquivo anterior segue
  // intacto em qualquer um dos caminhos.
  const [pwdAsk, setPwdAsk] = useState<
    { bytes: Uint8Array; name: string; mime: string; wrong: boolean } | null
  >(null);
  const [pwdValue, setPwdValue] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false); // "Remover senha" rodando no dialog
  const [discovering, setDiscovering] = useState(false); // popup Descobrir senha aberto
  // senha com que o PDF atual foi aberto — viaja no handoff SÓ pra /unlock
  // (ver decisão em actionFile.ts); nunca é gravada
  const [openPassword, setOpenPassword] = useState<string | null>(null);

  /** openBytes + tratamento de erro (toast) e de senha (dialog). Não lança. */
  const tryOpenBytes = async (
    bytes: Uint8Array,
    fileName: string,
    mimeType: string,
    password?: string,
  ) => {
    try {
      await openBytes(bytes, fileName, mimeType, password);
      setOpenPassword(password ?? null);
      setPwdAsk(null); // sucesso: fecha o dialog (no retry) e limpa a senha
      setPwdValue("");
    } catch (e) {
      if (isPasswordError(e)) {
        setPwdAsk({ bytes, name: fileName, mime: mimeType, wrong: isWrongPasswordError(e) });
        setPwdValue("");
        return;
      }
      setPwdAsk(null);
      toast.error(`Erro ao abrir: ${e instanceof Error ? e.message : e}`);
    }
  };

  const submitPwd = () => {
    if (!pwdAsk || !pwdValue) return;
    void tryOpenBytes(pwdAsk.bytes, pwdAsk.name, pwdAsk.mime, pwdValue);
  };
  const cancelPwd = () => {
    setPwdAsk(null);
    setPwdValue("");
  };

  /**
   * "Remover senha" no dialog: decifra com a senha digitada (qpdf), abre a
   * CÓPIA sem senha no viewer e oferece Salvar/Compartilhar (ResultPanel).
   * Senha errada → mesma mensagem do dialog; a senha não é guardada.
   */
  const unlockFromDialog = async () => {
    if (!pwdAsk || !pwdValue || pwdBusy) return;
    setPwdBusy(true);
    try {
      const r = await unlockPdf(pwdAsk.bytes, pwdValue);
      if (r.status === "needs-password") {
        setPwdAsk({ ...pwdAsk, wrong: true });
        return;
      }
      if (r.status === "not-encrypted") {
        // não deveria acontecer (o dialog só abre com PasswordException)
        await tryOpenBytes(pwdAsk.bytes, pwdAsk.name, pwdAsk.mime);
        return;
      }
      if (r.status === "error") {
        toast.error(`Erro ao remover senha: ${r.message}`);
        return;
      }
      const outName = unlockedName(pwdAsk.name);
      await openBytes(r.bytes, outName, "application/pdf");
      setOpenPassword(null);
      setResult([{
        blob: new Blob([r.bytes.slice()], { type: "application/pdf" }),
        name: outName,
        collection: "downloads",
      }]);
      setPwdAsk(null);
      setPwdValue("");
      toast.success("Senha removida — cópia aberta sem senha");
    } catch (e) {
      toast.error(`Erro ao remover senha: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPwdBusy(false);
    }
  };

  /** Descobrir senha achou: abre a cópia sem senha e mostra qual era a senha. */
  const onDiscoverFound = async (password: string, decrypted: Uint8Array) => {
    const outName = pwdAsk ? unlockedName(pwdAsk.name) : unlockedName(name ?? "documento.pdf");
    setDiscovering(false);
    try {
      await openBytes(decrypted, outName, "application/pdf");
      setOpenPassword(null);
      setResult([{
        blob: new Blob([decrypted.slice()], { type: "application/pdf" }),
        name: outName,
        collection: "downloads",
      }]);
      setPwdAsk(null);
      setPwdValue("");
      toast.success(`Senha descoberta: ${password} — cópia aberta sem senha`);
    } catch (e) {
      toast.error(`Erro ao abrir a cópia: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handleOpen = async () => {
    const [f] = await pickFiles(`application/pdf,${DOCX_MIME},.docx`);
    if (!f) return;
    try {
      const mime = isDocxFile(f.name, f.type) ? DOCX_MIME : "application/pdf";
      await tryOpenBytes(new Uint8Array(await f.arrayBuffer()), f.name, mime);
    } catch (e) {
      // tryOpenBytes não lança — só o arrayBuffer() do File chega aqui
      toast.error(`Erro ao abrir: ${e instanceof Error ? e.message : e}`);
    }
  };

  // ── Edição de Word ──────────────────────────────────────────────────────
  /** execCommand: deprecated mas universal na WebView; falha vira no-op. */
  const exec = (cmd: string, val?: string) => {
    try {
      document.execCommand(cmd, false, val);
    } catch {
      /* WebView sem suporte ao comando → silencioso (spec) */
    }
  };

  /** Editar: o editor ainda é o de texto (mammoth); a leitura fiel volta ao sair. */
  const startEdit = async () => {
    if (!blob) return;
    try {
      // sanitizeHtml: o HTML vai pro DOM principal (contentEditable), sem o
      // iframe sandbox da conversão — scripts/on*/refs externas caem antes
      setEditHtml(sanitizeHtml(await docxToHtml(new File([blob], name ?? "documento.docx"))));
      setResult(null);
      setEditing(true);
    } catch (e) {
      toast.error(`Erro ao editar: ${e instanceof Error ? e.message : e}`);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditHtml(null);
  };

  const saveEdit = async () => {
    const root = editRef.current;
    if (!root) return;
    try {
      const out = await editedDomToDocx(root);
      const base = (name ?? "documento").replace(/\.docx$/i, "");
      // leitura = versão salva, renderizada fiel como qualquer .docx
      setDocxDoc(await prepareDocx(new Uint8Array(await out.arrayBuffer())));
      setResult([{ blob: out, name: `${base}-editado.docx`, collection: "downloads" }]);
      setEditing(false);
      setEditHtml(null);
    } catch (e) {
      toast.error(`Erro ao salvar: ${e instanceof Error ? e.message : e}`);
    }
  };

  // foco no documento ao entrar em edição (abre o teclado no Android)
  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  // Arquivo vindo de fora (ACTION_VIEW ou botão Visualizar) — consumido do
  // store no mount E a cada navigate pro viewer (location.key muda mesmo
  // quando a rota é a mesma, ex.: novo intent com o viewer já aberto).
  useEffect(() => {
    const f = consumeOpenFile();
    if (!f) return;
    void tryOpenBytes(f.bytes, f.name, f.mimeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // libera o doc anterior sempre que troca de PDF, e o atual ao desmontar a tela
  useEffect(() => {
    return () => {
      if (doc) void destroyPdf(doc);
    };
  }, [doc]);

  // revoga o objectURL da imagem ao trocar de arquivo/desmontar
  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [imgUrl]);

  // Render virtualizado: 1 placeholder por página; IntersectionObserver renderiza
  // o canvas quando a página se aproxima do viewport (rootMargin) e DESCARTA os
  // canvases longe (volta a placeholder com a mesma altura) — no máx MAX_LIVE
  // canvases vivos, senão PDF de 100+ páginas derruba a WebView.
  // Zoom/doc mudam → efeito re-roda e re-observa. ZOOM no mesmo doc/modo é
  // DOUBLE-BUFFER: o DOM antigo NÃO é limpo — cada box é esticado via CSS pra
  // escala nova (stretchBox) e fica visível até o render novo trocá-lo
  // atomicamente no pump (replaceChildren) — zero frames de tela vazia.
  // Modo livro tem efeito próprio (abaixo); este só roda no contínuo.
  useEffect(() => {
    if (!doc || viewMode !== "continuous" || !containerRef.current) return;
    const container = containerRef.current;
    claimRef.current = true;
    // preview de pinch/duplo-toque sai no MESMO frame em que o conteúdo
    // esticado + scroll ajustado entram — sem "pulo" de escala no meio
    const stage = getStage(container, "continuous");
    clearPreview(stage);
    clearPreview(container);
    let cancelled = false;
    const MAX_LIVE = 12;
    const wrappers: HTMLDivElement[] = [];
    // páginas montadas: box = canvas + text layer (descartados juntos);
    // pixels = tamanho físico do canvas, pro orçamento de memória
    type LivePage = {
      box: HTMLDivElement;
      canvas: HTMLCanvasElement;
      text: { cancel: () => void };
      pixels: number;
    };
    const live = new Map<number, LivePage>();
    const near = new Set<number>(); // páginas dentro do rootMargin
    const wanted = new Set<number>(); // fila de render
    let rendering = false;
    let inflight: { cancel: () => void } | null = null; // render em andamento
    const baseW = container.clientWidth - 16;
    // resolução física = escala CSS × DPR (nitidez em tela de alta densidade),
    // limitada por VIEWER_MAX_CANVAS_PIXELS (zoom alto não estoura memória)
    const dpr = window.devicePixelRatio || 1;

    const discard = (p: number) => {
      const entry = live.get(p);
      if (!entry) return;
      // placeholder mantém a altura real já medida (setada no render) → scroll estável
      entry.text.cancel();
      entry.canvas.width = 0; // libera o backing store imediatamente
      entry.canvas.height = 0;
      entry.box.remove();
      live.delete(p);
    };

    // estoura o orçamento (contagem OU pixels físicos somados) → descarta as
    // páginas mais longe do viewport primeiro
    const livePixels = () => {
      let sum = 0;
      for (const e of live.values()) sum += e.pixels;
      return sum;
    };
    const overBudget = () => live.size > MAX_LIVE || livePixels() > LIVE_PIXEL_BUDGET;
    const evictFar = () => {
      if (!overBudget()) return;
      const anchor = near.size
        ? [...near].reduce((a, b) => a + b, 0) / near.size
        : 1;
      const farFirst = [...live.keys()]
        .filter((p) => !near.has(p))
        .sort((a, b) => Math.abs(b - anchor) - Math.abs(a - anchor));
      for (const p of farFirst) {
        if (!overBudget()) break;
        discard(p);
      }
    };

    /** Próxima página a renderizar: entre as pedidas e próximas, a mais perto
     *  do centro da tela — o que o usuário está vendo fica nítido primeiro. */
    const pickNext = (): number | undefined => {
      let best: number | undefined;
      let bestDist = Infinity;
      const mid = window.innerHeight / 2;
      for (const p of wanted) {
        if (!near.has(p) || live.has(p)) continue;
        const r = wrappers[p - 1]?.getBoundingClientRect();
        const d = r ? Math.abs((r.top + r.bottom) / 2 - mid) : Infinity;
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      return best;
    };

    // renderiza a fila sequencialmente (1 página por vez — memória e CPU suaves)
    const pump = async () => {
      if (rendering) return;
      rendering = true;
      try {
        for (;;) {
          if (cancelled) return;
          if (gestureRef.current) break; // pinça em curso: pumpRef retoma ao soltar
          const next = pickNext();
          if (next === undefined) break;
          wanted.delete(next);
          const page = await doc.getPage(next);
          if (cancelled) return;
          const scale = (baseW / page.getViewport({ scale: 1 }).width) * zoom;
          const render = startPageRender(page, scale, { dpr, maxPixels: VIEWER_MAX_CANVAS_PIXELS });
          inflight = render;
          let canvas: HTMLCanvasElement;
          try {
            canvas = await render.promise;
          } catch (e) {
            if (cancelled || isRenderCancelled(e)) {
              render.canvas.width = 0;
              render.canvas.height = 0;
              return;
            }
            throw e;
          } finally {
            inflight = null;
          }
          if (cancelled) {
            canvas.width = 0;
            canvas.height = 0;
            return;
          }
          const { viewport } = render; // tamanho CSS (lógico)
          // box relativo do tamanho CSS da página: canvas + text layer juntos
          const box = document.createElement("div");
          box.className = "relative mx-auto rounded shadow overflow-hidden";
          box.style.width = `${viewport.width}px`;
          box.style.height = `${viewport.height}px`;
          // metadados pro modo anotação (overlay recriável pela virtualização)
          box.dataset.annotBox = String(next);
          box.dataset.scale = String(scale);
          canvas.className = "block";
          const textDiv = document.createElement("div");
          textDiv.className = "textLayer";
          box.append(canvas, textDiv);
          const text = renderTextLayer(page, textDiv, viewport);
          const wrapper = wrappers[next - 1];
          // altura real (CSS, não física) substitui a estimada
          wrapper.style.height = `${viewport.height}px`;
          // troca ATÔMICA: o conteúdo antigo (double-buffer esticado) só sai
          // no mesmo instante em que o novo entra; backing stores liberados já
          const oldCanvases = [...wrapper.querySelectorAll("canvas")];
          wrapper.replaceChildren(box);
          for (const cv of oldCanvases) {
            cv.width = 0;
            cv.height = 0;
          }
          live.set(next, { box, canvas, text, pixels: canvas.width * canvas.height });
          void attachLinks(page, viewport, box); // links clicáveis do PDF
          // página recriada em modo anotação → overlay volta com as anotações
          if (annotatingRef.current) ensureOverlay(box);
          evictFar();
          // página sem texto/cancelada → segue sem seleção, sem derrubar o viewer
          await text.promise.catch(() => {});
          // busca ativa: pinta as ocorrências da página recém-renderizada (e
          // rola até a atual, se era ela que estava pendente)
          if (!cancelled) applyHighlightsRef.current();
        }
      } catch (e) {
        // doc destruído/trocado no meio do render (troca legítima) → silencia
        if (cancelled) return;
        console.error(e);
        toast.error("Erro ao renderizar PDF");
      } finally {
        rendering = false;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) {
            near.add(p);
            if (!live.has(p)) wanted.add(p);
          } else {
            near.delete(p);
            wanted.delete(p);
            // box "stale" (double-buffer de zoom anterior) longe do viewport:
            // vira placeholder sem re-render (fora da tela → não pisca)
            const w = wrappers[p - 1];
            if (w && !live.has(p) && w.firstElementChild) {
              releaseCanvases(w);
              w.replaceChildren();
            }
          }
        }
        evictFar();
        void pump();
      },
      // root: viewport (null) — o scroll real é do documento (min-h-full cresce
      // com o conteúdo); usar o container como root faria TODAS as páginas
      // "intersectarem" (a caixa dele tem a altura do conteúdo inteiro)
      { rootMargin: "1500px 0px" },
    );

    // reuse = zoom mudou no MESMO doc/modo com o DOM anterior intacto →
    // double-buffer (estica e re-renderiza por cima); senão, rebuild do zero
    const last = lastRenderRef.current;
    const reuse =
      last !== null &&
      last.doc === doc &&
      last.mode === "continuous" &&
      stage.querySelectorAll(":scope > [data-page]").length === doc.numPages;
    lastRenderRef.current = { doc, mode: "continuous", zoom, page: 0 };

    if (reuse) {
      const ratio = zoom / last.zoom;
      stage
        .querySelectorAll<HTMLDivElement>(":scope > [data-page]")
        .forEach((w) => {
          if (ratio !== 1) {
            w.style.height = `${parseFloat(w.style.height) * ratio}px`;
            const box = w.querySelector<HTMLElement>("[data-annot-box]");
            if (box) stretchBox(box, ratio);
          }
          wrappers.push(w);
          observer.observe(w);
        });
      // scroll acompanha a escala nova NO MESMO frame do estico (sem pulo):
      // pinch/duplo-toque trazem o ponto focal ancorado na página; zoom por
      // botão ancora o conteúdo sob o topo visível do container
      const scroller = document.scrollingElement;
      const focus = pendingFocusRef.current;
      pendingFocusRef.current = null;
      if (scroller && ratio !== 1) {
        if (focus) {
          scrollToAnchor(container, scroller, focus);
        } else {
          const rectTop = container.getBoundingClientRect().top;
          const fy = Math.max(rectTop, 0);
          const offsetTop = rectTop + scroller.scrollTop;
          scroller.scrollTop = Math.max(
            0,
            (scroller.scrollTop + fy - offsetTop) * ratio + offsetTop - fy,
          );
        }
      }
    } else {
      releaseCanvases(stage);
      stage.innerHTML = "";
      (async () => {
        try {
          // altura estimada dos placeholders a partir da página 1 (corrigida ao renderizar)
          const vp1 = (await doc.getPage(1)).getViewport({ scale: 1 });
          const estH = (baseW / vp1.width) * vp1.height * zoom;
          if (cancelled) return;
          for (let p = 1; p <= doc.numPages; p++) {
            const w = document.createElement("div");
            w.dataset.page = String(p);
            // 1 página só: my-auto centraliza vertical quando menor que a área
            // útil (container flex-col); excedeu → margens auto viram 0 e o
            // topo continua acessível no scroll
            w.className = doc.numPages === 1 ? "my-auto" : "mb-2";
            w.style.height = `${estH}px`;
            stage.appendChild(w);
            wrappers.push(w);
            observer.observe(w);
          }
          // alternância livro→contínuo: rola o documento até a página que
          // estava aberta no livro (48 ≈ altura do header sticky)
          if (pendingScrollPageRef.current !== null) {
            const target = wrappers[pendingScrollPageRef.current - 1];
            pendingScrollPageRef.current = null;
            const scroller = document.scrollingElement;
            if (target && scroller) {
              scroller.scrollTop = Math.max(
                0,
                target.getBoundingClientRect().top + scroller.scrollTop - 48,
              );
            }
          }
          // zoom via pinch sem double-buffer: ponto focal aproximado (a página
          // ainda é placeholder com a altura estimada)
          const focus = pendingFocusRef.current;
          pendingFocusRef.current = null;
          const scroller = document.scrollingElement;
          if (focus && scroller) scrollToAnchor(container, scroller, focus);
        } catch (e) {
          if (cancelled) return;
          console.error(e);
          toast.error("Erro ao renderizar PDF");
        }
      })();
    }

    pumpRef.current = () => void pump();

    return () => {
      cancelled = true;
      inflight?.cancel(); // zoom mudou de novo: não termina o render velho
      observer.disconnect();
      for (const { text } of live.values()) text.cancel();
      claimRef.current = false;
      // limpeza REAL adiada: se outro efeito assumir o container neste mesmo
      // commit (zoom/modo novos), o conteúdo antigo fica como double-buffer;
      // senão (unmount / arquivo não-PDF), libera canvases e esvazia
      queueMicrotask(() => {
        if (claimRef.current) return;
        releaseCanvases(stage);
        stage.replaceChildren();
        lastRenderRef.current = null;
      });
    };
  }, [doc, zoom, viewMode]);

  // ── Render do modo livro: SÓ a página atual no DOM (canvas + text layer +
  // overlay de anotação se anotando). O wrapper com margin:auto centraliza a
  // página quando menor que a área útil; maior (zoom) → scroll interno do
  // container. Zoom na MESMA página é DOUBLE-BUFFER: o conteúdo atual é
  // esticado via CSS pra escala nova e fica visível até o render novo trocar
  // tudo atomicamente — zero frames de tela vazia. Página/doc novos →
  // re-render do zero.
  useEffect(() => {
    if (!doc || viewMode !== "book" || !containerRef.current) return;
    const container = containerRef.current;
    claimRef.current = true;
    const stage = getStage(container, "book");
    clearPreview(stage); // assume o preview do pinch/duplo-toque
    clearPreview(container);
    let cancelled = false;
    let livePage: { canvas: HTMLCanvasElement; text: { cancel: () => void } } | null = null;
    let inflight: { cancel: () => void } | null = null; // render em andamento
    const baseW = container.clientWidth - 16;
    const dpr = window.devicePixelRatio || 1;

    const last = lastRenderRef.current;
    const reuse =
      last !== null &&
      last.doc === doc &&
      last.mode === "book" &&
      last.page === bookPage &&
      container.querySelector("[data-annot-box]") !== null;
    lastRenderRef.current = { doc, mode: "book", zoom, page: bookPage };
    let keepScroll: { left: number; top: number } | null = null;
    if (reuse) {
      const ratio = zoom / last.zoom;
      if (ratio !== 1) {
        const box = container.querySelector<HTMLElement>("[data-annot-box]");
        if (box) stretchBox(box, ratio);
        const focus = pendingFocusRef.current;
        pendingFocusRef.current = null;
        if (focus) {
          // pinch/duplo-toque: ponto focal ancorado na página
          scrollToAnchor(container, container, focus);
        } else {
          // zoom por botão: mantém o CENTRO da área visível
          container.scrollLeft = Math.max(
            0,
            (container.scrollLeft + container.clientWidth / 2) * ratio - container.clientWidth / 2,
          );
          container.scrollTop = Math.max(
            0,
            (container.scrollTop + container.clientHeight / 2) * ratio - container.clientHeight / 2,
          );
        }
      }
      keepScroll = { left: container.scrollLeft, top: container.scrollTop };
    } else {
      releaseCanvases(stage);
      stage.replaceChildren(); // limpa o conteúdo do outro modo/página
    }

    (async () => {
      try {
        const page = await doc.getPage(bookPage);
        if (cancelled) return;
        const scale = (baseW / page.getViewport({ scale: 1 }).width) * zoom;
        const render = startPageRender(page, scale, { dpr, maxPixels: VIEWER_MAX_CANVAS_PIXELS });
        inflight = render;
        let canvas: HTMLCanvasElement;
        try {
          canvas = await render.promise;
        } catch (e) {
          if (cancelled || isRenderCancelled(e)) {
            render.canvas.width = 0;
            render.canvas.height = 0;
            return;
          }
          throw e;
        } finally {
          inflight = null;
        }
        if (cancelled) {
          canvas.width = 0;
          canvas.height = 0;
          return;
        }
        const { viewport } = render;
        // mesma estrutura do contínuo: box (canvas + textLayer) com os
        // metadados que o modo anotação usa pra recriar o overlay
        const box = document.createElement("div");
        box.className = "relative rounded shadow overflow-hidden";
        box.style.width = `${viewport.width}px`;
        box.style.height = `${viewport.height}px`;
        box.dataset.annotBox = String(bookPage);
        box.dataset.scale = String(scale);
        canvas.className = "block";
        const textDiv = document.createElement("div");
        textDiv.className = "textLayer";
        box.append(canvas, textDiv);
        const text = renderTextLayer(page, textDiv, viewport);
        const wrapper = document.createElement("div");
        wrapper.dataset.page = String(bookPage);
        wrapper.className = "m-auto shrink-0"; // flex + margin:auto: centraliza E rola certo
        wrapper.appendChild(box);
        // troca ATÔMICA: o double-buffer esticado sai junto da entrada do novo
        const oldCanvases = [...stage.querySelectorAll("canvas")];
        stage.replaceChildren(wrapper);
        for (const cv of oldCanvases) {
          cv.width = 0;
          cv.height = 0;
        }
        livePage = { canvas, text };
        void attachLinks(page, viewport, box); // links clicáveis do PDF
        if (annotatingRef.current) ensureOverlay(box);
        const focus = pendingFocusRef.current;
        if (focus) {
          // pinch sem double-buffer: ponto focal ancorado na página recém-desenhada
          pendingFocusRef.current = null;
          scrollToAnchor(container, container, focus);
        } else if (keepScroll) {
          // zoom na mesma página: replaceChildren pode clampar o scroll → repõe
          container.scrollLeft = keepScroll.left;
          container.scrollTop = keepScroll.top;
        } else {
          container.scrollTop = 0; // página nova começa no topo
          container.scrollLeft = 0;
        }
        await text.promise.catch(() => {});
        if (!cancelled) applyHighlightsRef.current(); // busca ativa: destaca a página
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        toast.error("Erro ao renderizar PDF");
      }
    })();
    return () => {
      cancelled = true;
      inflight?.cancel();
      livePage?.text.cancel();
      claimRef.current = false;
      // mesma limpeza adiada do contínuo: só limpa se ninguém assumir o DOM
      queueMicrotask(() => {
        if (claimRef.current) return;
        releaseCanvases(stage);
        stage.replaceChildren();
        lastRenderRef.current = null;
      });
    };
  }, [doc, zoom, viewMode, bookPage]);

  // ── Swipe do modo livro: 1 dedo, movimento predominantemente horizontal e
  // ≥ SWIPE_MIN_PX navega. NÃO conflita com: pinch (2º pointer invalida o
  // gesto), seleção de texto (seleção ativa → ignora), pan interno da página
  // com zoom (há overflow horizontal → só navega se o scroll já está na borda)
  // e anotação (swipe desligado — 1 dedo é a ferramenta; navegação pelos ‹ ›).
  useEffect(() => {
    const el = containerRef.current;
    if (!doc || viewMode !== "book" || !el) return;
    const numPages = doc.numPages;
    let start: { id: number; x: number; y: number } | null = null;
    let multi = false; // um 2º pointer entrou no meio do gesto (pinch)
    let horizLock: boolean | null = null; // decidido no 1º move além do slop

    const atHorizEdge = (dx: number) => {
      const maxLeft = el.scrollWidth - el.clientWidth;
      if (maxLeft <= 1) return true; // sem overflow horizontal
      return dx < 0 ? el.scrollLeft >= maxLeft - 1 : el.scrollLeft <= 1;
    };
    const hasSelection = () => {
      const sel = window.getSelection();
      return Boolean(sel && !sel.isCollapsed);
    };

    const onDown = (e: PointerEvent) => {
      if (annotatingRef.current) return;
      if (start) {
        multi = true;
        return;
      }
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      multi = false;
      horizLock = null;
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const wasMulti = multi;
      start = null;
      horizLock = null;
      if (wasMulti) return;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
      if (hasSelection() || !atHorizEdge(dx)) return;
      setBookPage((p) => (dx < 0 ? Math.min(numPages, p + 1) : Math.max(1, p - 1)));
    };
    const onCancel = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) {
        start = null;
        horizLock = null;
      }
    };
    // gesto horizontal "trava" o touchmove (senão o scroll nativo assume e
    // dispara pointercancel antes do pointerup medir o deltaX do swipe)
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !start || multi || annotatingRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (horizLock === null && Math.hypot(dx, dy) > 10) {
        horizLock = Math.abs(dx) > Math.abs(dy) && atHorizEdge(dx) && !hasSelection();
      }
      if (horizLock) e.preventDefault();
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [doc, viewMode]);

  // Entrar no modo anotação: overlay nas páginas já vivas (as novas ganham o
  // seu no pump). Sair: remove todos (as anotações já foram descartadas).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (annotating) {
      container
        .querySelectorAll<HTMLElement>("[data-annot-box]")
        .forEach((box) => ensureOverlay(box));
    } else {
      container
        .querySelectorAll<HTMLCanvasElement>("canvas[data-annot-page]")
        .forEach((cv) => cv.remove());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotating]);

  // add/desfazer → repinta todos os overlays vivos (≤ MAX_LIVE, barato)
  useEffect(() => {
    containerRef.current
      ?.querySelectorAll<HTMLCanvasElement>("canvas[data-annot-page]")
      .forEach(repaintOverlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotCount]);

  // ferramenta "Mão": overlay deixa o toque passar (scroll normal de 1 dedo)
  useEffect(() => {
    containerRef.current
      ?.querySelectorAll<HTMLCanvasElement>("canvas[data-annot-page]")
      .forEach((cv) => {
        cv.style.pointerEvents = tool === "hand" ? "none" : "auto";
      });
  }, [tool]);

  // caixa de texto flutuante: foco ao abrir; zoom no meio descarta o rascunho
  // (a posição CSS guardada ficaria defasada — as anotações JÁ confirmadas
  // acompanham o zoom normalmente, pois vivem em pontos de página)
  useEffect(() => {
    if (textDraft) textInputRef.current?.focus();
  }, [textDraft]);
  useEffect(() => {
    setTextDraft(null);
    setTextValue("");
  }, [zoom, viewMode, bookPage]);

  // Gestos do modo anotação (delegação no container; move/up na window pra não
  // perder o traço quando o dedo sai da página). 1 pointer = ferramenta; um 2º
  // pointerdown no meio do gesto CANCELA o traço em andamento (evita rabisco
  // acidental quando o usuário tenta rolar com 2 dedos).
  useEffect(() => {
    const container = containerRef.current;
    if (!annotating || !doc || !container) return;
    type Active = {
      pointerId: number;
      cv: HTMLCanvasElement;
      page: number;
      scale: number;
      rect: DOMRect;
      wPt: number;
      hPt: number;
      kind: AnnotTool; // ferramenta no momento do pointerdown
      points: { x: number; y: number }[];
      start: { x: number; y: number };
      startClient: { x: number; y: number };
      moved: boolean;
    };
    let active: Active | null = null;

    const toPt = (a: Active, e: PointerEvent) => ({
      x: Math.min(a.wPt, Math.max(0, (e.clientX - a.rect.left) / a.scale)),
      y: Math.min(a.hPt, Math.max(0, (e.clientY - a.rect.top) / a.scale)),
    });
    const liveStroke = (a: Active): PdfAnnotation => ({
      kind: "draw", points: a.points, width: DRAW_PX / a.scale, color: colorRef.current,
    });
    const liveRect = (a: Active, p: { x: number; y: number }): PdfAnnotation => ({
      kind: "highlight",
      x: Math.min(a.start.x, p.x),
      y: Math.min(a.start.y, p.y),
      w: Math.abs(p.x - a.start.x),
      h: Math.abs(p.y - a.start.y),
      color: colorRef.current,
    });
    /** repinta o overlay do gesto: confirmadas + (opcional) anotação ao vivo */
    const paintLive = (a: Active, extra: PdfAnnotation | null) => {
      const committed = annotsRef.current.get(a.page) ?? [];
      const ratio = a.cv.width / parseFloat(a.cv.style.width);
      paintAnnotations(a.cv, extra ? [...committed, extra] : committed, a.scale, ratio);
    };

    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!(t instanceof HTMLCanvasElement) || !t.dataset.annotPage) return;
      if (draftOpenRef.current) {
        confirmDraftRef.current(); // tap fora da caixa de texto = confirmar
        return;
      }
      if (active) {
        paintLive(active, null); // 2º dedo → cancela o traço em andamento
        active = null;
        return;
      }
      const kind = toolRef.current;
      if (kind === "hand") return; // (overlay está pointer-events:none — defensivo)
      const scale = Number(t.dataset.scale);
      const a: Active = {
        pointerId: e.pointerId,
        cv: t,
        page: Number(t.dataset.annotPage),
        scale,
        rect: t.getBoundingClientRect(),
        wPt: parseFloat(t.style.width) / scale,
        hPt: parseFloat(t.style.height) / scale,
        kind,
        points: [],
        start: { x: 0, y: 0 },
        startClient: { x: e.clientX, y: e.clientY },
        moved: false,
      };
      const p = toPt(a, e);
      a.start = p;
      a.points = [p];
      active = a;
      if (kind === "draw") paintLive(a, liveStroke(a));
    };
    const onMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      if (
        Math.hypot(e.clientX - active.startClient.x, e.clientY - active.startClient.y) > 6
      ) {
        active.moved = true;
      }
      const p = toPt(active, e);
      if (active.kind === "draw") {
        active.points.push(p);
        paintLive(active, liveStroke(active));
      } else if (active.kind === "highlight") {
        paintLive(active, liveRect(active, p));
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const a = active;
      active = null;
      const p = toPt(a, e);
      if (a.kind === "text") {
        // tap (sem arrasto) posiciona a caixa de texto flutuante
        if (a.moved || !pdfWrapRef.current) return;
        const wr = pdfWrapRef.current.getBoundingClientRect();
        setTextValue("");
        setTextDraft({
          page: a.page, xPt: p.x, yPt: p.y,
          left: e.clientX - wr.left, top: e.clientY - wr.top,
        });
      } else if (a.kind === "draw") {
        commitAnnot(a.page, liveStroke(a)); // tap vira "ponto" (path de 1 ponto)
      } else if (a.kind === "highlight") {
        const r = liveRect(a, p);
        if (r.kind === "highlight" && r.w * a.scale > 4 && r.h * a.scale > 4) {
          commitAnnot(a.page, r);
        } else {
          paintLive(a, null); // retângulo mínimo → descarta o preview
        }
      }
    };
    const onCancel = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      paintLive(active, null);
      active = null;
    };

    container.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotating, doc]);

  // Pinch zoom: durante o gesto a coluna de páginas ganha will-change +
  // transform translate(dx,dy) scale(g) — camada própria no compositor: a GPU
  // só reamostra a textura já rasterizada (nada de re-raster por frame) e o
  // conteúdo acompanha os DOIS movimentos dos dedos (abrir/fechar E arrastar).
  // O pump de render fica em espera enquanto a pinça dura (gestureRef). Ao
  // soltar, o zoom final (clamp 0.5–3, igual aos botões) é comitado e o efeito
  // de render assume o transform no MESMO frame em que estica o conteúdo e
  // rola até o ponto focal (ancorado na página sob os dedos) parar onde os
  // dedos terminaram.
  // O zoom nativo da WebView está desligado (meta viewport) e touch-action:
  // pan-x pan-y deixa o browser rolar com 1 dedo mas entrega os pointer events
  // da pinça. Em modo anotação o pinch fica DESLIGADO (zoom pelos botões) — os
  // pointer events do desenho têm prioridade.
  useEffect(() => {
    const el = containerRef.current;
    if (!doc || !el || annotating) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture = false;
    let g = 1; // fator do gesto (dist atual / dist inicial), clampado
    let shift = { x: 0, y: 0 }; // deslocamento do ponto médio desde o início
    let startDist = 0;
    let startZoom = 1;
    let startMid = { x: 0, y: 0 };
    let startScrollTop = 0;
    let startAnchor: FocusAnchor | null = null; // ponto da página sob os dedos
    // modo livro (e o eixo horizontal do contínuo): scroll INTERNO do container
    let startElScroll = { left: 0, top: 0 };
    let fit: PreviewFit | null = null; // encaixe do preview (medido no início)

    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const mid = () => {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    // o transform do preview vai no STAGE (as páginas), nunca no viewport: o
    // viewport parado é o que faz o zoom-out mostrar só o gutter em volta da
    // página, em vez de encolher a tela e expor uma tarja preta lateral
    let target: HTMLElement = el;
    const clearTransform = () => {
      clearPreview(target);
      clearPreview(el);
    };
    const endGesture = () => {
      gesture = false;
      gestureRef.current = false;
      pumpRef.current(); // páginas que entraram na fila durante a pinça
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size !== 2) return;
      gesture = true;
      gestureRef.current = true;
      g = 1;
      shift = { x: 0, y: 0 };
      startDist = dist();
      startZoom = zoomRef.current;
      startMid = mid();
      const scroller = document.scrollingElement;
      startScrollTop = scroller?.scrollTop ?? 0;
      startAnchor = anchorAt(el, startMid.x, startMid.y);
      startElScroll = { left: el.scrollLeft, top: el.scrollTop };
      // origem = ponto focal em coordenadas do stage (ele pode começar acima
      // da tela, rolado): o conteúdo sob os dedos fica parado em qualquer g
      target = previewTarget(el);
      fit = measurePreviewFit(el, target, viewModeRef.current === "book", doc.numPages === 1);
      const trect = target.getBoundingClientRect();
      target.style.transformOrigin = `${startMid.x - trect.left}px ${startMid.y - trect.top}px`;
      target.style.willChange = "transform"; // camada própria: escala sem re-raster
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture || pointers.size < 2 || startDist === 0 || !fit) return;
      // clamp de g tal que a escala FINAL (startZoom*g) fique no 0.5–3 dos botões
      g = clampGesture(dist() / startDist, startZoom, 0.5, 3);
      const m = mid();
      shift = fitPreview(fit, g, startMid.x, startMid.y, m.x - startMid.x, m.y - startMid.y);
      target.style.transform = `translate(${shift.x}px, ${shift.y}px) scale(${g})`;
    };
    /** Fim da pinça: comita o zoom (ou só o arrasto, se a escala não mudou). */
    const commit = () => {
      const newZoom = Math.min(3, Math.max(0.5, startZoom * g));
      if (Math.abs(newZoom - startZoom) < 0.01) {
        // sem zoom: o arrasto dos 2 dedos vira scroll, senão o conteúdo
        // "voltaria" ao limpar o transform
        if (viewModeRef.current === "book") {
          el.scrollLeft = Math.max(0, startElScroll.left - shift.x);
          el.scrollTop = Math.max(0, startElScroll.top - shift.y);
        } else {
          const scroller = document.scrollingElement;
          if (scroller) scroller.scrollTop = Math.max(0, startScrollTop - shift.y);
          el.scrollLeft = Math.max(0, startElScroll.left - shift.x);
        }
        clearTransform();
        return;
      }
      // NÃO limpa o transform aqui: o preview da pinça segura a tela até o
      // efeito de render assumir (ele zera o transform no MESMO frame em que
      // estica o conteúdo e ajusta o scroll) — sem piscar nem pulo de escala.
      // O ponto da página que começou sob os dedos vai pra onde eles
      // terminaram no preview (nos dois eixos: sem o horizontal a página
      // "escorregava" pra borda esquerda — bug visto no device em 09/09)
      pendingFocusRef.current = startAnchor && {
        ...startAnchor,
        x: startMid.x + shift.x,
        y: startMid.y + shift.y,
      };
      setZoom(newZoom); // mesmo fluxo do botão: efeito de render re-roda na nova escala
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (!gesture || pointers.size >= 2) return;
      endGesture();
      commit();
    };
    const onCancel = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (!gesture || pointers.size >= 2) return;
      // a WebView pode cancelar os pointers no meio da pinça: comita o que já
      // foi feito em vez de voltar atrás (era o "pulo" de escala do vídeo)
      endGesture();
      commit();
    };
    // impede o scroll nativo de 2 dedos de brigar com a pinça (precisa ser
    // touchmove não-passivo; preventDefault em pointermove não bloqueia scroll)
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("touchmove", onTouchMove);
      gestureRef.current = false;
      clearTransform();
    };
  }, [doc, annotating]);

  // ── Duplo-toque: alterna zoom 1 ↔ DBLTAP_ZOOM centrado no ponto tocado
  // (touch E duplo clique), nos DOIS modos. Detector próprio: 2 taps
  // < DBLTAP_MS e < DBLTAP_DIST no container, com preventDefault no touchend
  // do 2º tap ANTES da seleção de palavra nativa do Android disparar.
  // DECISÃO: duplo-toque SEMPRE dá zoom, inclusive sobre texto — a seleção de
  // palavra por duplo-toque nativo fica desligada dentro do viewer (long-press
  // continua selecionando normalmente). Não conflita com pinch (2º pointer
  // invalida o tap), com o swipe do livro (movimento > TAP_SLOP descarta) nem
  // com long-press (> TAP_MAX_MS não é tap). Em modo anotação o efeito nem
  // anexa (duplo-toque desabilitado lá).
  useEffect(() => {
    const el = containerRef.current;
    if (!doc || !el || annotating) return;
    let down: { id: number; t: number; x: number; y: number; multi: boolean } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let suppressTouchEnd = false;
    let anim = 0;

    /** Anima o transform até a escala alvo e comita o zoom — o efeito de
     *  render assume o transform no mesmo frame do estico (double-buffer). */
    const zoomTo = (target: number, fx: number, fy: number) => {
      const ratio = target / zoomRef.current;
      // anima o STAGE (páginas), não o viewport — mesma razão da pinça
      const stageEl = previewTarget(el);
      // a animação termina onde o layout comitado vai pôr a página (mesmo
      // encaixe da pinça) e o ponto tocado, ancorado na página, vai junto
      const book = viewModeRef.current === "book";
      const s = fitPreview(measurePreviewFit(el, stageEl, book, doc.numPages === 1), ratio, fx, fy, 0, 0);
      const a = anchorAt(el, fx, fy);
      pendingFocusRef.current = a && { ...a, x: fx + s.x, y: fy + s.y };
      const srect = stageEl.getBoundingClientRect();
      stageEl.style.transformOrigin = `${fx - srect.left}px ${fy - srect.top}px`;
      stageEl.style.willChange = "transform";
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / DBLTAP_ANIM_MS);
        stageEl.style.transform = `translate(${s.x * k}px, ${s.y * k}px) scale(${1 + (ratio - 1) * k})`;
        if (k < 1) anim = requestAnimationFrame(step);
        else setZoom(target); // efeito de render limpa o transform e estica
      };
      anim = requestAnimationFrame(step);
    };

    const onDown = (e: PointerEvent) => {
      if (down) {
        down.multi = true; // 2º dedo = pinch, não é tap
        return;
      }
      down = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, multi: false };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      down = null;
      const now = performance.now();
      if (
        d.multi ||
        now - d.t > TAP_MAX_MS ||
        Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP
      ) {
        lastTap = null;
        return;
      }
      if (
        lastTap &&
        now - lastTap.t < DBLTAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DBLTAP_DIST
      ) {
        lastTap = null;
        suppressTouchEnd = true; // touchend deste tap vem DEPOIS do pointerup
        window.getSelection()?.removeAllRanges();
        const z = zoomRef.current;
        zoomTo(Math.abs(z - 1) < 0.01 ? DBLTAP_ZOOM : 1, e.clientX, e.clientY);
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    };
    const onCancel = (e: PointerEvent) => {
      if (down && e.pointerId === down.id) down = null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (suppressTouchEnd) {
        suppressTouchEnd = false;
        e.preventDefault(); // bloqueia seleção de palavra/click nativos do 2º tap
      }
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => {
      cancelAnimationFrame(anim);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [doc, annotating]);

  const hasContent = Boolean(doc || imgUrl || docxDoc);

  // ── Pesquisa no documento ────────────────────────────────────────────────
  // PDF: índice por página (pdfSearch.ts, getTextContent) → ocorrências →
  // Ranges sobre os spans do text layer das páginas VIVAS (virtualização) via
  // CSS Custom Highlight API (searchHighlight.ts). Word: mesmo núcleo sobre
  // os nós de texto das páginas do Word. Navegar: contínuo rola o documento
  // (página ainda não renderizada → scrollIntoView do placeholder e o pump
  // termina o trabalho ao renderizar); livro troca a página. Destaques são
  // re-aplicados a cada página renderizada (pump) e a cada mudança de estado.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [current, setCurrent] = useState(-1);
  const [searching, setSearching] = useState(false);
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const currentRef = useRef(current);
  currentRef.current = current;
  const pageIndexRef = useRef<Map<number, PageIndex>>(new Map()); // peças por página (fatiar em spans)
  const docxPiecesRef = useRef<{ nodes: Text[]; pieces: Piece[] } | null>(null);
  const pendingMatchRef = useRef<number | null>(null); // ocorrência a rolar quando o nó dela existir

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setMatches([]);
    setCurrent(-1);
    setSearching(false);
    pendingMatchRef.current = null;
    clearSearchHighlights();
  };

  // arquivo novo / edição / anotação → fecha a busca (os nós destacados morrem)
  useEffect(() => {
    pageIndexRef.current = new Map();
    docxPiecesRef.current = null;
    if (searchOpenRef.current) closeSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, docxDoc, imgUrl, editing, annotating]);

  /** Vai pra ocorrência idx da lista dada (a lista pode ainda não estar no estado). */
  const goToMatch = (list: SearchMatch[], idx: number) => {
    setCurrent(idx);
    pendingMatchRef.current = idx < 0 ? null : idx;
    if (idx < 0) return;
    const m = list[idx];
    if (m.page === 0) return; // Word: o efeito de destaque rola direto
    const container = containerRef.current;
    if (!container) return;
    if (viewModeRef.current === "book") {
      if (bookPageRef.current !== m.page) setBookPage(m.page); // render → pump rola
      return;
    }
    const wrapper = container.querySelector<HTMLElement>(`[data-page="${m.page}"]`);
    const layer = wrapper?.querySelector<HTMLElement>(".textLayer");
    if (!(layer && getTextLayerDivs(layer))) {
      // placeholder: aproxima; o observer renderiza e o pump rola no trecho exato
      wrapper?.scrollIntoView({ block: "start" });
    }
  };

  const stepMatch = (dir: 1 | -1) => {
    const list = matchesRef.current;
    if (list.length === 0) return;
    const base = currentRef.current < 0 ? (dir > 0 ? -1 : 0) : currentRef.current;
    goToMatch(list, (base + dir + list.length) % list.length);
  };

  /** 1ª ocorrência na página visível ou depois dela (senão a primeira). */
  const firstMatchFrom = (list: SearchMatch[], page: number) => {
    const i = list.findIndex((m) => m.page >= page);
    return i < 0 ? 0 : i;
  };

  // consulta (debounce) → busca; PDF em background com contador ao vivo
  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    pendingMatchRef.current = null;
    if (!q) {
      setMatches([]);
      setCurrent(-1);
      setSearching(false);
      clearSearchHighlights();
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      if (doc) {
        setSearching(true);
        searchPdf(doc, q, {
          signal: ac.signal,
          onPage: (idx) => pageIndexRef.current.set(idx.page, idx),
          onProgress: (found) => setMatches([...found]),
        })
          .then((found) => {
            setMatches(found);
            setSearching(false);
            goToMatch(found, found.length ? firstMatchFrom(found, mostVisiblePage()) : -1);
          })
          .catch((e: unknown) => {
            if ((e as { name?: string } | null)?.name === "AbortError") return;
            console.error(e);
            setSearching(false);
            toast.error("Erro ao pesquisar no PDF");
          });
      } else if (docxDoc && docxRef.current) {
        const nodes = collectTextNodes(docxRef.current);
        // separador só na fronteira de BLOCO (parágrafo, título, item, célula);
        // formatação inline (negrito no meio da palavra) mantém o texto contínuo
        const blockOf = (n: Text) => n.parentElement?.closest(DOCX_BLOCKS) ?? null;
        const parts = nodes.map((n, i) => ({
          text: n.data,
          sepAfter: i + 1 < nodes.length && blockOf(nodes[i + 1]) !== blockOf(n),
        }));
        const { text, pieces } = buildText(parts);
        docxPiecesRef.current = { nodes, pieces };
        const found = findMatches(normalizeForSearch(text), q).map((m) => ({ page: 0, ...m }));
        setMatches(found);
        goToMatch(found, found.length ? 0 : -1);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen, doc, docxDoc]);

  /** (Re)aplica os destaques nos nós vivos; rola até a ocorrência pendente
   *  quando o nó dela já existe. Chamado pelo efeito de estado e pelo pump. */
  const applySearchHighlights = () => {
    const list = matchesRef.current;
    const cur = currentRef.current;
    if (!searchOpenRef.current || list.length === 0) {
      clearSearchHighlights();
      return;
    }
    const all: Range[] = [];
    const curRanges: Range[] = [];
    const push = (node: Node | null | undefined, s: number, e: number, isCur: boolean) => {
      if (!node || node.nodeType !== Node.TEXT_NODE || !node.isConnected) return;
      const r = rangeOver(node as Text, s, e);
      all.push(r);
      if (isCur) curRanges.push(r);
    };
    const isDocx = list[0].page === 0;
    if (isDocx) {
      const d = docxPiecesRef.current;
      if (d) {
        list.forEach((m, i) => {
          for (const seg of splitMatch(m, d.pieces)) push(d.nodes[seg.piece], seg.start, seg.end, i === cur);
        });
      }
    } else {
      const byPage = new Map<number, { m: SearchMatch; i: number }[]>();
      list.forEach((m, i) => {
        const arr = byPage.get(m.page);
        if (arr) arr.push({ m, i });
        else byPage.set(m.page, [{ m, i }]);
      });
      containerRef.current
        ?.querySelectorAll<HTMLElement>("[data-annot-box]")
        .forEach((box) => {
          const page = Number(box.dataset.annotBox);
          const layer = box.querySelector<HTMLElement>(".textLayer");
          const divs = layer ? getTextLayerDivs(layer) : undefined;
          const idx = pageIndexRef.current.get(page);
          const onPage = byPage.get(page);
          if (!divs || !idx || !onPage) return;
          for (const { m, i } of onPage) {
            for (const seg of splitMatch(m, idx.pieces)) {
              push(divs[seg.piece]?.firstChild, seg.start, seg.end, i === cur);
            }
          }
        });
    }
    setSearchHighlights(all, curRanges);
    const scroller = isDocx ? docxRef.current : containerRef.current;
    if (pendingMatchRef.current === cur && curRanges.length > 0 && scroller) {
      const vertical = !isDocx && viewModeRef.current === "book" ? "container" : "document";
      if (scrollToRange(curRanges[0], scroller, vertical)) pendingMatchRef.current = null;
    }
  };
  const applyHighlightsRef = useRef(applySearchHighlights);
  applyHighlightsRef.current = applySearchHighlights;
  useEffect(() => {
    applyHighlightsRef.current();
  }, [matches, current, searchOpen]);

  const countLabel = searching
    ? `${matches.length}…`
    : matches.length > 0
      ? `${current + 1}/${matches.length}`
      : query.trim()
        ? "0"
        : "";

  // Salvar o arquivo ABERTO no dispositivo: imagem → galeria, PDF/Word →
  // Downloads (mesma convenção de collection das telas de resultado)
  const saveOpenFile = async () => {
    if (!blob || !name) return;
    try {
      await saveToDevice(blob, name, imgUrl ? "images" : "downloads");
      toast.success(imgUrl ? "Imagem salva na galeria" : "Arquivo salvo em Downloads");
    } catch (e) {
      toast.error(`Erro ao salvar: ${e instanceof Error ? e.message : e}`);
    }
  };

  // layout do modo livro: raiz presa à altura da tela (sem scroll do documento);
  // o scroll vira interno do container da página
  const bookLayout = Boolean(doc) && viewMode === "book";
  // Objeto ESTÁVEL pro dangerouslySetInnerHTML: o React 19 re-seta o innerHTML
  // sempre que a identidade do objeto muda (não compara o __html) — cada
  // re-render do viewer recriava os nós e matava a edição não salva.
  const editHtmlProp = useMemo(() => (editHtml ? { __html: editHtml } : undefined), [editHtml]);
  // arquivo aberto e pronto pras ações da barra inferior (funções/salvar/compartilhar)
  const fileReady = hasContent && Boolean(blob) && Boolean(name);

  return (
    <div className={bookLayout ? "h-full flex flex-col overflow-hidden" : "min-h-full flex flex-col"}>
      {/* topo: só o que mexe na LEITURA (modo, zoom, lápis); o resto (pesquisar,
          funções, salvar, compartilhar, histórico) mora na barra inferior */}
      <header className="bg-slate-900 sticky top-0 z-10">
        <div className="flex items-center gap-3 p-3">
          <Link to="/"><ArrowLeft size={18} /></Link>
          <span className="flex-1 text-sm truncate">{name ?? "Visualizar"}</span>
          {doc && (
            <button
              type="button"
              aria-label={viewMode === "book" ? "Modo contínuo" : "Modo livro"}
              title={viewMode === "book" ? "Modo contínuo" : "Modo livro"}
              onClick={toggleViewMode}
            >
              {viewMode === "book" ? <ScrollText size={18} /> : <BookOpen size={18} />}
            </button>
          )}
          {(doc || imgUrl || (docxDoc && !editing)) && (
            <>
              <button type="button" aria-label="Diminuir zoom"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                <ZoomOut size={18} />
              </button>
              <button type="button" aria-label="Aumentar zoom"
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                <ZoomIn size={18} />
              </button>
            </>
          )}
          {docxDoc && !editing && (
            <button type="button" aria-label="Editar" onClick={() => void startEdit()}>
              <Pencil size={18} />
            </button>
          )}
          {doc && !annotating && (
            <button type="button" aria-label="Anotar" onClick={startAnnotating}>
              <Pencil size={18} />
            </button>
          )}
          {editing && (
            <>
              <button type="button" onClick={saveEdit}
                className="px-3 py-1.5 bg-blue-600 rounded-lg text-xs font-medium">
                Salvar
              </button>
              <button type="button" onClick={cancelEdit}
                className="px-3 py-1.5 bg-slate-700 rounded-lg text-xs">
                Cancelar
              </button>
            </>
          )}
          {annotating && (
            <>
              <button type="button" onClick={saveAnnotations}
                className="px-3 py-1.5 bg-blue-600 rounded-lg text-xs font-medium">
                Salvar
              </button>
              <button type="button" onClick={exitAnnotating}
                className="px-3 py-1.5 bg-slate-700 rounded-lg text-xs">
                Cancelar
              </button>
            </>
          )}
        </div>
        {annotating && (
          <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
            <AnnotBtn label="Texto" active={tool === "text"} onClick={() => setTool("text")}>
              <Type size={16} />
            </AnnotBtn>
            <AnnotBtn label="Desenho" active={tool === "draw"} onClick={() => setTool("draw")}>
              <PenLine size={16} />
            </AnnotBtn>
            <AnnotBtn label="Marca-texto" active={tool === "highlight"}
              onClick={() => setTool("highlight")}>
              <Highlighter size={16} />
            </AnnotBtn>
            <AnnotBtn label="Mover" active={tool === "hand"} onClick={() => setTool("hand")}>
              <Hand size={16} />
            </AnnotBtn>
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            {ANNOT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={`Cor ${c.nome}`}
                title={`Cor ${c.nome}`}
                onClick={() => setColor(c.hex)}
                className={`w-6 h-6 rounded-full border border-slate-600 ${
                  color === c.hex ? "ring-2 ring-white" : ""
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            <AnnotBtn label="Desfazer" disabled={annotCount === 0} onClick={undoAnnot}>
              <Undo2 size={16} />
            </AnnotBtn>
          </div>
        )}
        {editing && (
          <div className="flex items-center gap-1.5 px-3 pb-2">
            <ToolBtn label="Negrito" onClick={() => exec("bold")}><Bold size={16} /></ToolBtn>
            <ToolBtn label="Itálico" onClick={() => exec("italic")}><Italic size={16} /></ToolBtn>
            <ToolBtn label="Lista" onClick={() => exec("insertUnorderedList")}>
              <List size={16} />
            </ToolBtn>
            <ToolBtn label="Título" onClick={() => exec("formatBlock", "H2")}>Título</ToolBtn>
            <ToolBtn label="Normal" onClick={() => exec("formatBlock", "P")}>Normal</ToolBtn>
          </div>
        )}
      </header>
      {/* keys distintos: sem eles o React REUSA o mesmo <div> ao trocar de
          modo e os canvases do pdf.js (inseridos imperativamente, fora do
          React) ficariam no DOM acima da imagem (visto no QA do emulador) */}
      {imgUrl ? (
        <div key="image" className="flex-1 overflow-auto p-2">
          <img src={imgUrl} alt={name ?? "imagem"}
            className="mx-auto rounded shadow max-w-full"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }} />
        </div>
      ) : docxDoc ? (
        <div key="docx" className="flex-1 flex flex-col">
          {result && <div className="p-3 pb-0"><ResultPanel files={result} /></div>}
          {editing ? (
            <div className="p-3">
              {/* documento "papel": fundo branco e texto preto num app dark */}
              <div
                ref={editRef}
                contentEditable
                suppressContentEditableWarning
                className="docx-doc mx-auto w-full max-w-[820px] bg-white text-black rounded shadow outline-none ring-2 ring-blue-500"
                dangerouslySetInnerHTML={editHtmlProp}
              />
            </div>
          ) : (
            <DocxView
              ref={docxRef}
              prepared={docxDoc}
              zoom={zoom}
              onZoom={setZoom}
              onError={(e) => toast.error(`Erro ao mostrar o Word: ${e instanceof Error ? e.message : e}`)}
            />
          )}
        </div>
      ) : doc ? (
        // wrapper relativo: ancora a caixa de texto flutuante (que rola junto
        // com o conteúdo) sem tocar no container imperativo da virtualização
        <div
          key="pdf"
          ref={pdfWrapRef}
          className={`relative flex-1 flex flex-col ${bookLayout ? "min-h-0" : ""}`}
        >
          {result && !annotating && (
            <div className="p-3 pb-0"><ResultPanel files={result} /></div>
          )}
          {/* modo livro: display:flex + min-h-0 → filho m-auto centraliza a
              página e o overflow interno rola certo quando ela é maior.
              contínuo: flex-col → wrapper my-auto centraliza PDF de 1 página
              menor que a área útil (maior → margens auto zeram, topo acessível) */}
          <div
            ref={containerRef}
            className={`flex-1 overflow-auto p-2 flex ${bookLayout ? "min-h-0" : "flex-col"}`}
            style={{ touchAction: "pan-x pan-y" }}
          />
          {bookLayout && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 bg-slate-900/90 border border-slate-700 rounded-full px-1.5 py-1 shadow-lg">
              <button
                type="button"
                aria-label="Página anterior"
                disabled={bookPage <= 1}
                onClick={() => setBookPage((p) => Math.max(1, p - 1))}
                className={`p-1 ${bookPage <= 1 ? "opacity-40" : ""}`}
              >
                <ChevronLeft size={16} />
              </button>
              <span data-book-indicator="" className="text-xs tabular-nums px-1"
                aria-label={`Página ${bookPage} de ${doc.numPages}`}>
                {bookPage}/{doc.numPages}
              </span>
              <button
                type="button"
                aria-label="Próxima página"
                disabled={bookPage >= doc.numPages}
                onClick={() => setBookPage((p) => Math.min(doc.numPages, p + 1))}
                className={`p-1 ${bookPage >= doc.numPages ? "opacity-40" : ""}`}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          {textDraft && (
            <div
              className="absolute z-20 flex items-center gap-1 bg-slate-900/95 border border-slate-600 rounded-lg p-1 shadow-lg"
              style={{ left: textDraft.left, top: textDraft.top }}
            >
              <input
                ref={textInputRef}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmTextDraft();
                  if (e.key === "Escape") setTextDraft(null);
                }}
                placeholder="Texto…"
                aria-label="Texto da anotação"
                className="w-40 px-2 py-1 bg-slate-800 rounded text-sm outline-none"
              />
              <button type="button" aria-label="Confirmar texto"
                onMouseDown={(e) => e.preventDefault()}
                onClick={confirmTextDraft}
                className="p-1.5 bg-blue-600 rounded">
                <Check size={14} />
              </button>
              <button type="button" aria-label="Descartar texto"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setTextDraft(null)}
                className="p-1.5 bg-slate-700 rounded">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <button type="button" onClick={handleOpen}
            className="px-6 py-3 bg-blue-600 rounded-xl text-sm font-medium">
            Escolher arquivo
          </button>
        </div>
      )}
      {/* barra inferior: pesquisar · funções · salvar · compartilhar · histórico
          (oculta em anotação/edição, que têm Salvar/Cancelar no topo). Com a
          pesquisa aberta, a barra vira o campo de busca + contador + ▲▼. */}
      {!editing && !annotating && (
        <nav
          data-bottom-bar
          className="sticky bottom-0 z-10 bg-slate-900 border-t border-slate-800 pb-[env(safe-area-inset-bottom)]"
        >
          {searchOpen ? (
            <div data-search-bar className="flex items-center gap-1.5 px-2 py-2">
              <button type="button" aria-label="Fechar pesquisa" title="Fechar pesquisa"
                onClick={closeSearch} className="p-1.5 text-slate-300">
                <X size={18} />
              </button>
              <input
                type="search"
                autoFocus
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    stepMatch(e.shiftKey ? -1 : 1);
                  }
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="Pesquisar no documento"
                aria-label="Pesquisar no documento"
                className="flex-1 min-w-0 px-3 py-1.5 bg-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span data-search-count
                className="text-xs tabular-nums text-slate-400 whitespace-nowrap min-w-[2.5rem] text-center">
                {countLabel}
              </span>
              <button type="button" aria-label="Ocorrência anterior" title="Ocorrência anterior"
                disabled={matches.length === 0} onClick={() => stepMatch(-1)}
                className="p-1.5 text-slate-300 disabled:opacity-40">
                <ChevronUp size={18} />
              </button>
              <button type="button" aria-label="Próxima ocorrência" title="Próxima ocorrência"
                disabled={matches.length === 0} onClick={() => stepMatch(1)}
                className="p-1.5 text-slate-300 disabled:opacity-40">
                <ChevronDown size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-stretch px-1">
              {(doc || docxDoc) && (
                <BarBtn label="Pesquisar" onClick={() => setSearchOpen(true)}>
                  <Search size={20} />
                </BarBtn>
              )}
              {fileReady && blob && name && (
                <ActionsMenu
                  kind={(doc ? "pdf" : imgUrl ? "image" : "docx") as ViewerFileKind}
                  file={{
                    blob,
                    name,
                    mimeType: blob.type ||
                      (doc ? "application/pdf" : imgUrl ? "image/png" : DOCX_MIME),
                    password: openPassword ?? undefined,
                  }}
                >
                  {(open) => (
                    <BarBtn label="Funções" onClick={open}>
                      <LayoutGrid size={20} />
                    </BarBtn>
                  )}
                </ActionsMenu>
              )}
              {fileReady && (
                <BarBtn label="Salvar" onClick={saveOpenFile}>
                  <Download size={20} />
                </BarBtn>
              )}
              {fileReady && blob && name && (
                <ShareMenu payload={{ kind: "blobs", files: [{ blob, name }] }}>
                  {(open) => (
                    <BarBtn label="Compartilhar" onClick={open}>
                      <Share2 size={20} />
                    </BarBtn>
                  )}
                </ShareMenu>
              )}
              <RecentsButton
                category="viewer"
                label="Histórico"
                onPick={async (f) => {
                  await tryOpenBytes(new Uint8Array(await f.arrayBuffer()), f.name, f.type);
                }}
              />
            </div>
          )}
        </nav>
      )}
      {pwdAsk && (
        <div
          data-pwd-dialog
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
        >
          <div className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium">PDF protegido — digite a senha</p>
            <p className="text-xs text-slate-400 truncate">{pwdAsk.name}</p>
            <input
              type="password"
              autoFocus
              value={pwdValue}
              onChange={(e) => setPwdValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPwd();
                if (e.key === "Escape") cancelPwd();
              }}
              placeholder="Senha"
              aria-label="Senha do PDF"
              className="w-full px-3 py-2 bg-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            {pwdAsk.wrong && (
              <p data-pwd-wrong className="text-xs text-red-400">
                Senha incorreta, tente novamente
              </p>
            )}
            {/* opção abaixo do campo: com senha digitada = Remover; campo vazio
                = Descobrir senha (tenta senhas comuns/datas/números) */}
            {pwdValue ? (
              <>
                <button
                  type="button"
                  data-pwd-unlock
                  disabled={pwdBusy}
                  onClick={() => void unlockFromDialog()}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-slate-600 rounded-lg text-sm text-slate-200 disabled:opacity-40"
                >
                  <LockOpen size={14} className="text-blue-400" />
                  {pwdBusy ? "Removendo senha…" : "Remover senha deste PDF"}
                </button>
                <p className="text-[11px] text-slate-500 -mt-1">
                  Gera uma cópia sem senha (abre em qualquer app) e a mostra aqui.
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-pwd-discover
                  disabled={pwdBusy}
                  onClick={() => setDiscovering(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-slate-600 rounded-lg text-sm text-slate-200 disabled:opacity-40"
                >
                  <LockOpen size={14} className="text-blue-400" />
                  Descobrir senha
                </button>
                <p className="text-[11px] text-slate-500 -mt-1">
                  Não sabe a senha? Tento senhas comuns, datas e números para você.
                </p>
              </>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={cancelPwd} disabled={pwdBusy}
                className="flex-1 py-2 bg-slate-700 rounded-lg text-sm disabled:opacity-40">
                Cancelar
              </button>
              <button type="button" disabled={!pwdValue || pwdBusy} onClick={submitPwd}
                className="flex-1 py-2 bg-blue-600 rounded-lg text-sm font-medium disabled:opacity-40">
                Abrir
              </button>
            </div>
          </div>
        </div>
      )}
      {discovering && pwdAsk && (
        <DiscoverPassword
          bytes={pwdAsk.bytes}
          fileName={pwdAsk.name}
          onFound={(pw, dec) => void onDiscoverFound(pw, dec)}
          onCancel={() => setDiscovering(false)}
          onNotFound={() => {
            setDiscovering(false);
            toast.info("Não consegui descobrir a senha automaticamente. Se você souber, digite-a.");
          }}
          onUnsupported={() => {
            setDiscovering(false);
            toast.error("Não foi possível analisar a proteção deste PDF.");
          }}
        />
      )}
    </div>
  );
};
export default Viewer;
