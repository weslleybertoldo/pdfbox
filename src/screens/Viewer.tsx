import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Share2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { pickFiles, shareBlob } from "../lib/files";
import { loadPdf, renderPage, destroyPdf, type PdfDoc } from "../lib/pdfRender";

const Viewer = () => {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOpen = async () => {
    const [f] = await pickFiles("application/pdf");
    if (!f) return;
    try {
      setFile(f);
      setDoc(await loadPdf(new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      toast.error(`Erro ao abrir: ${e instanceof Error ? e.message : e}`);
    }
  };

  // libera o doc anterior sempre que troca de PDF, e o atual ao desmontar a tela
  useEffect(() => {
    return () => {
      if (doc) void destroyPdf(doc);
    };
  }, [doc]);

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
    const live = new Map<number, HTMLCanvasElement>(); // páginas com canvas montado
    const near = new Set<number>(); // páginas dentro do rootMargin
    const wanted = new Set<number>(); // fila de render
    let rendering = false;
    const baseW = container.clientWidth - 16;

    const discard = (p: number) => {
      const canvas = live.get(p);
      if (!canvas) return;
      // placeholder mantém a altura real já medida (setada no render) → scroll estável
      canvas.width = 0; // libera o backing store imediatamente
      canvas.height = 0;
      canvas.remove();
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
          const canvas = await renderPage(doc, next, scale);
          if (cancelled) {
            canvas.width = 0;
            canvas.height = 0;
            return;
          }
          canvas.className = "mx-auto rounded shadow max-w-none";
          const wrapper = wrappers[next - 1];
          wrapper.style.height = `${canvas.height}px`; // altura real substitui a estimada
          wrapper.replaceChildren(canvas);
          live.set(next, canvas);
          evictFar();
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
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        toast.error("Erro ao renderizar PDF");
      }
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [doc, zoom]);

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center gap-3 p-3 bg-slate-900 sticky top-0 z-10">
        <Link to="/"><ArrowLeft size={18} /></Link>
        <span className="flex-1 text-sm truncate">{file?.name ?? "Visualizar PDF"}</span>
        {doc && (
          <>
            <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              <ZoomOut size={18} />
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              <ZoomIn size={18} />
            </button>
            <button type="button" onClick={() => file && shareBlob(file, file.name)}>
              <Share2 size={18} />
            </button>
          </>
        )}
      </header>
      {!doc ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <button type="button" onClick={handleOpen}
            className="px-6 py-3 bg-blue-600 rounded-xl text-sm font-medium">
            Escolher PDF
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-auto p-2" />
      )}
    </div>
  );
};
export default Viewer;
