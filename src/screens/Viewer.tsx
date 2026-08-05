import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeft, Bold, BookOpen, Check, ChevronLeft, ChevronRight, Hand,
  Highlighter, Italic, List, Pencil, PenLine, ScrollText, Share2, Type,
  Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { pickFiles, shareBlob, DOCX_MIME, isDocxFile } from "../lib/files";
import {
  loadPdf,
  renderPage,
  renderTextLayer,
  destroyPdf,
  type PdfDoc,
} from "../lib/pdfRender";
import {
  annotatePdf,
  paintAnnotations,
  type AnnotationMap,
  type PdfAnnotation,
} from "../lib/pdfAnnotate";
import { consumeOpenFile } from "../lib/openFileStore";
import { docxToHtml } from "../lib/convert/docxToPdf";
import { sanitizeHtml } from "../lib/convert/htmlPipeline";
import { editedDomToDocx } from "../lib/convert/htmlToDocx";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";

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

const Viewer = () => {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null); // p/ compartilhar
  const [name, setName] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null); // modo imagem
  const [docxHtml, setDocxHtml] = useState<string | null>(null); // modo Word (mammoth, sanitizado)
  const [editing, setEditing] = useState(false); // modo docx: contentEditable ligado
  const [result, setResult] = useState<ResultFile[] | null>(null); // .docx salvo da edição
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEWER_MODE_KEY) === "book" ? "book" : "continuous",
  );
  const [bookPage, setBookPage] = useState(1); // página atual do modo livro (1-based)
  const containerRef = useRef<HTMLDivElement>(null);
  const docxRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom); // valor atual pro handler de pinch (efeito só depende de doc)
  const pendingScrollRef = useRef<number | null>(null); // scrollTop a aplicar após re-render de zoom
  const pendingScrollPageRef = useRef<number | null>(null); // livro→contínuo: rolar até a página
  const pendingBookScrollRef = useRef<{ left: number; top: number } | null>(null); // pinch no livro
  const location = useLocation();
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  useEffect(() => {
    localStorage.setItem(VIEWER_MODE_KEY, viewMode);
  }, [viewMode]);

  /** Toggle contínuo↔livro preservando a página atual. */
  const toggleViewMode = () => {
    if (viewMode === "continuous") {
      // página mais visível no viewport vira a página do livro
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
      setBookPage(best);
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
    cv.style.zIndex = "2"; // acima do textLayer (z-index 1)
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

  /** Abre bytes de qualquer origem (picker, intent externo, ResultPanel). */
  const openBytes = async (bytes: Uint8Array, fileName: string, mimeType: string) => {
    // .slice() garante Uint8Array<ArrayBuffer> (BlobPart) e evita o detach
    // do buffer pelo worker do pdf.js (loadPdf também copia internamente)
    const b = new Blob([bytes.slice()], { type: mimeType });
    setName(fileName);
    setBlob(b);
    setZoom(1);
    setBookPage(1); // arquivo novo começa na 1ª página (modo livro persiste)
    setEditing(false);
    setResult(null);
    exitAnnotating(); // troca de arquivo descarta anotações em andamento
    if (isDocxFile(fileName, mimeType)) {
      setDoc(null);
      setImgUrl(null);
      // sanitizeHtml: o HTML vai pro DOM principal (contentEditable), sem o
      // iframe sandbox da conversão — scripts/on*/refs externas caem antes
      setDocxHtml(sanitizeHtml(await docxToHtml(new File([b], fileName))));
    } else if (mimeType.startsWith("image/")) {
      setDoc(null);
      setDocxHtml(null);
      setImgUrl(URL.createObjectURL(b));
    } else {
      setImgUrl(null);
      setDocxHtml(null);
      setDoc(await loadPdf(bytes));
    }
  };

  const handleOpen = async () => {
    const [f] = await pickFiles(`application/pdf,${DOCX_MIME},.docx`);
    if (!f) return;
    try {
      const mime = isDocxFile(f.name, f.type) ? DOCX_MIME : "application/pdf";
      await openBytes(new Uint8Array(await f.arrayBuffer()), f.name, mime);
    } catch (e) {
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

  const startEdit = () => {
    setResult(null);
    setEditing(true);
  };

  /** Cancelar: restaura o HTML de leitura (React não re-seta __html igual). */
  const cancelEdit = () => {
    if (docxRef.current && docxHtml) docxRef.current.innerHTML = docxHtml;
    setEditing(false);
  };

  const saveEdit = async () => {
    const root = docxRef.current;
    if (!root) return;
    try {
      const out = await editedDomToDocx(root);
      const base = (name ?? "documento").replace(/\.docx$/i, "");
      setDocxHtml(root.innerHTML); // leitura (e futuros cancelar) = versão salva
      setResult([{ blob: out, name: `${base}-editado.docx`, collection: "downloads" }]);
      setEditing(false);
    } catch (e) {
      toast.error(`Erro ao salvar: ${e instanceof Error ? e.message : e}`);
    }
  };

  // foco no documento ao entrar em edição (abre o teclado no Android)
  useEffect(() => {
    if (editing) docxRef.current?.focus();
  }, [editing]);

  // Arquivo vindo de fora (ACTION_VIEW ou botão Visualizar) — consumido do
  // store no mount E a cada navigate pro viewer (location.key muda mesmo
  // quando a rota é a mesma, ex.: novo intent com o viewer já aberto).
  useEffect(() => {
    const f = consumeOpenFile();
    if (!f) return;
    openBytes(f.bytes, f.name, f.mimeType).catch((e) => {
      toast.error(`Erro ao abrir: ${e instanceof Error ? e.message : e}`);
    });
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
  // Zoom/doc mudam → efeito re-roda: invalida tudo e re-observa.
  // Modo livro tem efeito próprio (abaixo); este só roda no contínuo.
  useEffect(() => {
    if (!doc || viewMode !== "continuous" || !containerRef.current) return;
    const container = containerRef.current;
    container.innerHTML = "";
    let cancelled = false;
    const MAX_LIVE = 12;
    const wrappers: HTMLDivElement[] = [];
    // páginas montadas: box = canvas + text layer (descartados juntos)
    type LivePage = { box: HTMLDivElement; canvas: HTMLCanvasElement; text: { cancel: () => void } };
    const live = new Map<number, LivePage>();
    const near = new Set<number>(); // páginas dentro do rootMargin
    const wanted = new Set<number>(); // fila de render
    let rendering = false;
    const baseW = container.clientWidth - 16;
    // resolução física = escala CSS × DPR (nitidez em tela de alta densidade)
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

    const evictFar = () => {
      if (live.size <= MAX_LIVE) return;
      const anchor = near.size
        ? [...near].reduce((a, b) => a + b, 0) / near.size
        : 1;
      const farFirst = [...live.keys()]
        .filter((p) => !near.has(p))
        .sort((a, b) => Math.abs(b - anchor) - Math.abs(a - anchor));
      for (const p of farFirst) {
        if (live.size <= MAX_LIVE) break;
        discard(p);
      }
    };

    // renderiza a fila sequencialmente (1 página por vez — memória e CPU suaves)
    const pump = async () => {
      if (rendering) return;
      rendering = true;
      try {
        for (;;) {
          if (cancelled) return;
          const next = [...wanted].find((p) => near.has(p) && !live.has(p));
          if (next === undefined) break;
          wanted.delete(next);
          const page = await doc.getPage(next);
          const scale = (baseW / page.getViewport({ scale: 1 }).width) * zoom;
          const viewport = page.getViewport({ scale }); // tamanho CSS (lógico)
          const canvas = await renderPage(doc, next, scale, { dpr });
          if (cancelled) {
            canvas.width = 0;
            canvas.height = 0;
            return;
          }
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
          wrapper.replaceChildren(box);
          live.set(next, { box, canvas, text });
          // página recriada em modo anotação → overlay volta com as anotações
          if (annotatingRef.current) ensureOverlay(box);
          evictFar();
          // página sem texto/cancelada → segue sem seleção, sem derrubar o viewer
          await text.promise.catch(() => {});
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

    (async () => {
      try {
        // altura estimada dos placeholders a partir da página 1 (corrigida ao renderizar)
        const vp1 = (await doc.getPage(1)).getViewport({ scale: 1 });
        const estH = (baseW / vp1.width) * vp1.height * zoom;
        if (cancelled) return;
        for (let p = 1; p <= doc.numPages; p++) {
          const w = document.createElement("div");
          w.dataset.page = String(p);
          w.className = "mb-2";
          w.style.height = `${estH}px`;
          container.appendChild(w);
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
        // zoom via pinch: restaura a posição de scroll aproximada do ponto focal
        if (pendingScrollRef.current !== null) {
          const scroller = document.scrollingElement;
          if (scroller) scroller.scrollTop = pendingScrollRef.current;
          pendingScrollRef.current = null;
        }
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        toast.error("Erro ao renderizar PDF");
      }
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      for (const p of [...live.keys()]) discard(p); // libera canvases/text layers
    };
  }, [doc, zoom, viewMode]);

  // ── Render do modo livro: SÓ a página atual no DOM (canvas + text layer +
  // overlay de anotação se anotando). O wrapper com margin:auto centraliza a
  // página quando menor que a área útil; maior (zoom) → scroll interno do
  // container. Zoom/página mudam → re-render na escala nova.
  useEffect(() => {
    if (!doc || viewMode !== "book" || !containerRef.current) return;
    const container = containerRef.current;
    container.replaceChildren(); // limpa o conteúdo do outro modo/página
    let cancelled = false;
    let livePage: { canvas: HTMLCanvasElement; text: { cancel: () => void } } | null = null;
    const baseW = container.clientWidth - 16;
    const dpr = window.devicePixelRatio || 1;
    (async () => {
      try {
        const page = await doc.getPage(bookPage);
        const scale = (baseW / page.getViewport({ scale: 1 }).width) * zoom;
        const viewport = page.getViewport({ scale });
        const canvas = await renderPage(doc, bookPage, scale, { dpr });
        if (cancelled) {
          canvas.width = 0;
          canvas.height = 0;
          return;
        }
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
        container.replaceChildren(wrapper);
        livePage = { canvas, text };
        if (annotatingRef.current) ensureOverlay(box);
        if (pendingBookScrollRef.current) {
          // pinch: restaura o ponto focal aproximado no scroll interno
          container.scrollLeft = pendingBookScrollRef.current.left;
          container.scrollTop = pendingBookScrollRef.current.top;
          pendingBookScrollRef.current = null;
        } else {
          container.scrollTop = 0; // página nova começa no topo
          container.scrollLeft = 0;
        }
        await text.promise.catch(() => {});
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        toast.error("Erro ao renderizar PDF");
      }
    })();
    return () => {
      cancelled = true;
      if (livePage) {
        livePage.text.cancel();
        livePage.canvas.width = 0; // libera o backing store imediatamente
        livePage.canvas.height = 0;
      }
      container.replaceChildren();
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

  // Pinch zoom = zoom do botão: durante o gesto, transform: scale(g) no wrapper
  // das páginas (visual imediato, barato); ao soltar, limpa o transform e
  // re-renderiza na escala final (mesmo fluxo/clamp 0.5–3 dos botões),
  // preservando a posição de scroll aproximada do ponto focal. O zoom nativo
  // da WebView está desligado (meta viewport) e touch-action: pan-x pan-y
  // deixa o browser rolar com 1 dedo mas entrega os pointer events da pinça.
  // Em modo anotação o pinch fica DESLIGADO (zoom pelos botões) — os pointer
  // events do desenho têm prioridade.
  useEffect(() => {
    const el = containerRef.current;
    if (!doc || !el || annotating) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture = false;
    let g = 1; // fator do gesto (dist atual / dist inicial), clampado
    let startDist = 0;
    let startZoom = 1;
    let startMid = { x: 0, y: 0 };
    let startScrollTop = 0;
    let startOffsetTop = 0; // topo do container em coordenadas do documento
    // modo livro: o scroll que importa é o INTERNO do container
    let startElScroll = { left: 0, top: 0 };
    let startRect = { left: 0, top: 0 };

    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const clearTransform = () => {
      el.style.transform = "";
      el.style.transformOrigin = "";
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size !== 2) return;
      const [a, b] = [...pointers.values()];
      gesture = true;
      g = 1;
      startDist = dist();
      startZoom = zoomRef.current;
      startMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scroller = document.scrollingElement;
      startScrollTop = scroller?.scrollTop ?? 0;
      const rect = el.getBoundingClientRect();
      startOffsetTop = rect.top + startScrollTop;
      startElScroll = { left: el.scrollLeft, top: el.scrollTop };
      startRect = { left: rect.left, top: rect.top };
      el.style.transformOrigin = `${startMid.x - rect.left}px ${startMid.y - rect.top}px`;
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture || pointers.size < 2 || startDist === 0) return;
      // clamp de g tal que a escala FINAL (startZoom*g) fique no 0.5–3 dos botões
      g = Math.min(3 / startZoom, Math.max(0.5 / startZoom, dist() / startDist));
      el.style.transform = `scale(${g})`;
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (!gesture || pointers.size >= 2) return;
      gesture = false;
      clearTransform();
      const newZoom = Math.min(3, Math.max(0.5, startZoom * g));
      if (Math.abs(newZoom - startZoom) < 0.01) return;
      const ratio = newZoom / startZoom;
      if (viewModeRef.current === "book") {
        // modo livro: restaura o foco no scroll INTERNO do container
        const fx = startMid.x - startRect.left;
        const fy = startMid.y - startRect.top;
        pendingBookScrollRef.current = {
          left: Math.max(0, (startElScroll.left + fx) * ratio - fx),
          top: Math.max(0, (startElScroll.top + fy) * ratio - fy),
        };
      } else {
        // scrollTop' ≈ (scrollTop + focoY - topoContainer)*ratio + topoContainer - focoY
        pendingScrollRef.current = Math.max(
          0,
          (startScrollTop + startMid.y - startOffsetTop) * ratio + startOffsetTop - startMid.y,
        );
      }
      setZoom(newZoom); // mesmo fluxo do botão: efeito de render re-roda na nova escala
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (gesture && pointers.size < 2) {
        gesture = false;
        clearTransform(); // gesto abortado: mantém o zoom atual
      }
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
      clearTransform();
    };
  }, [doc, annotating]);

  const hasContent = Boolean(doc || imgUrl || docxHtml);
  // layout do modo livro: raiz presa à altura da tela (sem scroll do documento);
  // o scroll vira interno do container da página
  const bookLayout = Boolean(doc) && viewMode === "book";

  return (
    <div className={bookLayout ? "h-full flex flex-col overflow-hidden" : "min-h-full flex flex-col"}>
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
          {(doc || imgUrl) && (
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
          {docxHtml && !editing && (
            <button type="button" aria-label="Editar" onClick={startEdit}>
              <Pencil size={18} />
            </button>
          )}
          {doc && !annotating && (
            <button type="button" aria-label="Anotar" onClick={startAnnotating}>
              <Pencil size={18} />
            </button>
          )}
          {hasContent && !editing && !annotating && (
            <button type="button" aria-label="Compartilhar"
              onClick={() => blob && name && shareBlob(blob, name)}>
              <Share2 size={18} />
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
      ) : docxHtml ? (
        <div key="docx" className="flex-1 p-3 space-y-3">
          {result && <ResultPanel files={result} />}
          {/* documento "papel": fundo branco e texto preto num app dark */}
          <div
            ref={docxRef}
            contentEditable={editing}
            suppressContentEditableWarning
            className={`docx-doc mx-auto w-full max-w-[820px] bg-white text-black rounded shadow outline-none ${
              editing ? "ring-2 ring-blue-500" : ""
            }`}
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
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
              página e o overflow interno rola certo quando ela é maior */}
          <div
            ref={containerRef}
            className={`flex-1 overflow-auto p-2 ${bookLayout ? "min-h-0 flex" : ""}`}
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
    </div>
  );
};
export default Viewer;
