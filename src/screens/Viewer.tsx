import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Share2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { pickFiles, shareBlob } from "../lib/files";
import {
  loadPdf,
  renderPage,
  renderTextLayer,
  destroyPdf,
  type PdfDoc,
} from "../lib/pdfRender";
import { consumeOpenFile } from "../lib/openFileStore";

const Viewer = () => {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null); // p/ compartilhar
  const [name, setName] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null); // modo imagem
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom); // valor atual pro handler de pinch (efeito só depende de doc)
  const pendingScrollRef = useRef<number | null>(null); // scrollTop a aplicar após re-render de zoom
  const location = useLocation();
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /** Abre bytes de qualquer origem (picker, intent externo, ResultPanel). */
  const openBytes = async (bytes: Uint8Array, fileName: string, mimeType: string) => {
    // .slice() garante Uint8Array<ArrayBuffer> (BlobPart) e evita o detach
    // do buffer pelo worker do pdf.js (loadPdf também copia internamente)
    const b = new Blob([bytes.slice()], { type: mimeType });
    setName(fileName);
    setBlob(b);
    setZoom(1);
    if (mimeType.startsWith("image/")) {
      setDoc(null);
      setImgUrl(URL.createObjectURL(b));
    } else {
      setImgUrl(null);
      setDoc(await loadPdf(bytes));
    }
  };

  const handleOpen = async () => {
    const [f] = await pickFiles("application/pdf");
    if (!f) return;
    try {
      await openBytes(new Uint8Array(await f.arrayBuffer()), f.name, "application/pdf");
    } catch (e) {
      toast.error(`Erro ao abrir: ${e instanceof Error ? e.message : e}`);
    }
  };

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
  useEffect(() => {
    if (!doc || !containerRef.current) return;
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
  }, [doc, zoom]);

  // Pinch zoom = zoom do botão: durante o gesto, transform: scale(g) no wrapper
  // das páginas (visual imediato, barato); ao soltar, limpa o transform e
  // re-renderiza na escala final (mesmo fluxo/clamp 0.5–3 dos botões),
  // preservando a posição de scroll aproximada do ponto focal. O zoom nativo
  // da WebView está desligado (meta viewport) e touch-action: pan-x pan-y
  // deixa o browser rolar com 1 dedo mas entrega os pointer events da pinça.
  useEffect(() => {
    const el = containerRef.current;
    if (!doc || !el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture = false;
    let g = 1; // fator do gesto (dist atual / dist inicial), clampado
    let startDist = 0;
    let startZoom = 1;
    let startMid = { x: 0, y: 0 };
    let startScrollTop = 0;
    let startOffsetTop = 0; // topo do container em coordenadas do documento

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
      // scrollTop' ≈ (scrollTop + focoY - topoContainer)*ratio + topoContainer - focoY
      const ratio = newZoom / startZoom;
      pendingScrollRef.current = Math.max(
        0,
        (startScrollTop + startMid.y - startOffsetTop) * ratio + startOffsetTop - startMid.y,
      );
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
  }, [doc]);

  const hasContent = Boolean(doc || imgUrl);

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center gap-3 p-3 bg-slate-900 sticky top-0 z-10">
        <Link to="/"><ArrowLeft size={18} /></Link>
        <span className="flex-1 text-sm truncate">{name ?? "Visualizar PDF"}</span>
        {hasContent && (
          <>
            <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              <ZoomOut size={18} />
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              <ZoomIn size={18} />
            </button>
            <button type="button" onClick={() => blob && name && shareBlob(blob, name)}>
              <Share2 size={18} />
            </button>
          </>
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
      ) : doc ? (
        <div
          key="pdf"
          ref={containerRef}
          className="flex-1 overflow-auto p-2"
          style={{ touchAction: "pan-x pan-y" }}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <button type="button" onClick={handleOpen}
            className="px-6 py-3 bg-blue-600 rounded-xl text-sm font-medium">
            Escolher PDF
          </button>
        </div>
      )}
    </div>
  );
};
export default Viewer;
