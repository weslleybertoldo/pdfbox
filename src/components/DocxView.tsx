import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { renderPaginated, DOCX_CLASS, type PreparedDocx } from "../lib/docx/render";
import { openExternalLink } from "../lib/openLink";
import { clampGesture } from "../lib/zoomMath";

interface Props {
  prepared: PreparedDocx;
  /** zoom do viewer (1 = página na largura da tela), 0,5–3 */
  zoom: number;
  onZoom: (z: number) => void;
  onError: (e: unknown) => void;
}

const PAD = 8; // gutter lateral, igual ao p-2 do PDF
const ZMIN = 0.5;
const ZMAX = 3;
const DBLTAP_MS = 300;
const DBLTAP_DIST = 30;
const TAP_SLOP = 12;
const TAP_MAX_MS = 250;
const DBLTAP_ZOOM = 2;

/** Ponto das páginas (coordenadas sem escala) que deve parar na tela em (x, y). */
interface Focus {
  px: number;
  py: number;
  x: number;
  y: number;
}

/**
 * Word fiel: páginas da docx-preview, paginadas, encaixadas na largura da tela.
 * Render + paginação acontecem num palco escondido SEM escala (medidas em px
 * do documento) e só então as páginas entram no palco visível. A escala é um
 * transform (não relayouta: as quebras medidas continuam valendo) dentro de
 * uma caixa com o tamanho já escalado, que é o que rola. Pinça: transform
 * provisório seguindo os dedos; ao soltar, comita o zoom e rola pra deixar o
 * ponto entre os dedos parado. O ref exposto é o scroller (raiz da busca e do
 * scroll horizontal).
 */
const DocxView = forwardRef<HTMLDivElement, Props>(function DocxView(
  { prepared, zoom, onZoom, onError },
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState({ w: 0, h: 0 }); // tamanho natural das páginas
  const [viewW, setViewW] = useState(0);
  const [ready, setReady] = useState(false);
  const focusRef = useRef<Focus | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useImperativeHandle(ref, () => scrollerRef.current as HTMLDivElement, []);

  // render + paginação num palco escondido (sem escala), depois move pro visível
  useEffect(() => {
    const scroller = scrollerRef.current;
    const stage = stageRef.current;
    const styles = stylesRef.current;
    if (!scroller || !stage || !styles) return;
    let alive = true;
    setReady(false);
    const hidden = document.createElement("div");
    hidden.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden;";
    const tmpStyles = document.createElement("div");
    const tmpPages = document.createElement("div");
    hidden.append(tmpStyles, tmpPages);
    scroller.appendChild(hidden);
    renderPaginated(prepared, tmpPages, tmpStyles)
      .then(() => {
        if (!alive) return;
        styles.replaceChildren(...Array.from(tmpStyles.childNodes));
        stage.replaceChildren(...Array.from(tmpPages.childNodes));
        const pages = Array.from(stage.querySelectorAll<HTMLElement>(`section.${DOCX_CLASS}`));
        setNat({
          w: pages.length ? Math.max(...pages.map((s) => s.offsetWidth)) : 0,
          h: stage.offsetHeight,
        });
        setReady(true);
      })
      .catch((e) => {
        if (alive) onErrorRef.current(e);
      })
      .finally(() => hidden.remove());
    return () => {
      alive = false;
      hidden.remove();
    };
  }, [prepared]);

  // largura útil (girar a tela, abrir o teclado...)
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = nat.w > 0 && viewW > 0 ? (viewW - 2 * PAD) / nat.w : 1;
  const scale = fit * zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // zoom novo aplicado: limpa o preview e rola até o ponto focal
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const sizer = sizerRef.current;
    const scroller = scrollerRef.current;
    if (!stage || !sizer || !scroller) return;
    stage.style.transform = `scale(${scale})`;
    stage.style.willChange = "";
    const f = focusRef.current;
    if (!f) return;
    focusRef.current = null;
    const r = sizer.getBoundingClientRect();
    scroller.scrollLeft += r.left + f.px * scale - f.x;
    const doc = document.scrollingElement ?? document.documentElement;
    doc.scrollTop += r.top + f.py * scale - f.y;
  }, [scale]);

  // pinça + toque duplo
  useEffect(() => {
    const el = scrollerRef.current;
    const stage = stageRef.current;
    const sizer = sizerRef.current;
    if (!el || !stage || !sizer) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let startZoom = 1;
    let g = 1;
    let startMid = { x: 0, y: 0 };
    let shift = { x: 0, y: 0 };
    let origin = { x: 0, y: 0 }; // ponto focal relativo à caixa (px na tela)
    let down: { id: number; t: number; x: number; y: number; multi: boolean } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const mid = () => {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    /** Comita o zoom mantendo o ponto (sx, sy) da caixa na tela em (x, y). */
    const commit = (target: number, sx: number, sy: number, x: number, y: number) => {
      const z = Math.min(ZMAX, Math.max(ZMIN, target));
      const s = scaleRef.current;
      if (Math.abs(z - zoomRef.current) < 0.001) {
        stage.style.transform = `scale(${s})`;
        return;
      }
      focusRef.current = { px: sx / s, py: sy / s, x, y };
      onZoomRef.current(z);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (down) down.multi = true;
      else down = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, multi: false };
      if (pointers.size !== 2) return;
      startDist = dist();
      startZoom = zoomRef.current;
      g = 1;
      startMid = mid();
      shift = { x: 0, y: 0 };
      const r = sizer.getBoundingClientRect();
      origin = { x: startMid.x - r.left, y: startMid.y - r.top };
      stage.style.willChange = "transform";
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size < 2 || startDist === 0) return;
      g = clampGesture(dist() / startDist, startZoom, ZMIN, ZMAX);
      const m = mid();
      shift = { x: m.x - startMid.x, y: m.y - startMid.y };
      // ponto focal parado sob os dedos: translada o que a escala a mais deslocaria
      const tx = origin.x * (1 - g) + shift.x;
      const ty = origin.y * (1 - g) + shift.y;
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scaleRef.current * g})`;
    };
    const onUp = (e: PointerEvent) => {
      const wasPinch = startDist > 0 && pointers.size === 2;
      pointers.delete(e.pointerId);
      if (wasPinch) {
        startDist = 0;
        commit(startZoom * g, origin.x, origin.y, startMid.x + shift.x, startMid.y + shift.y);
      }
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      down = null;
      const now = performance.now();
      if (d.multi || now - d.t > TAP_MAX_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) {
        lastTap = null;
        return;
      }
      if (
        lastTap &&
        now - lastTap.t < DBLTAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DBLTAP_DIST
      ) {
        lastTap = null;
        window.getSelection()?.removeAllRanges();
        const r = sizer.getBoundingClientRect();
        const target = Math.abs(zoomRef.current - 1) < 0.01 ? DBLTAP_ZOOM : 1;
        commit(target, e.clientX - r.left, e.clientY - r.top, e.clientX, e.clientY);
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (down?.id === e.pointerId) down = null;
      if (startDist > 0 && pointers.size < 2) {
        startDist = 0;
        stage.style.transform = `scale(${scaleRef.current})`;
      }
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  /** Links do documento: nunca navegam a WebView (externo → Custom Tab). */
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest?.("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      if (id) stageRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
    } else if (href) void openExternalLink(href);
  };

  return (
    <div
      ref={scrollerRef}
      data-docx-view=""
      className="relative flex-1 overflow-x-auto overflow-y-hidden py-2"
      style={{ touchAction: "pan-x pan-y", paddingLeft: PAD, paddingRight: PAD }}
      onClick={onClick}
    >
      <div ref={stylesRef} hidden />
      {!ready && <p className="text-center text-sm text-slate-400 py-8">Abrindo o documento…</p>}
      <div
        ref={sizerRef}
        className="mx-auto"
        style={{ width: nat.w * scale, height: nat.h * scale, visibility: ready ? "visible" : "hidden" }}
      >
        <div
          ref={stageRef}
          data-docx-stage=""
          style={{ width: nat.w || undefined, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        />
      </div>
    </div>
  );
});

export default DocxView;
