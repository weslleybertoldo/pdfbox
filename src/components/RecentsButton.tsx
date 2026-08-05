import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  clearRecents,
  getRecentBlob,
  listRecents,
  removeRecent,
  type RecentMeta,
} from "../lib/recents";
import { formatBytes } from "../lib/files";

/** Data curta: "05/08 14:32". */
const fmtDate = (ts: number) =>
  new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Itens visíveis por "página" — scroll no fim do painel carrega mais. */
const PAGE_SIZE = 10;
/** Largura do painel: ~90vw, até 360px. */
const PANEL_MAX_WIDTH = 360;

interface PanelPos {
  top: number;
  left: number;
  width: number;
}

/**
 * Ícone de histórico + painel dropdown com os últimos arquivos usados na
 * função (categoria). Tap num item reconstrói o File e entrega no onPick —
 * o fluxo da tela roda com ele como entrada, sem abrir o picker.
 *
 * O painel é renderizado via portal (createPortal pro body) com
 * position:fixed ancorado logo abaixo do botão — nenhum ancestral (header
 * sticky, containers com overflow) consegue cortá-lo, em qualquer tela.
 */
const RecentsButton = ({ category, onPick }: {
  category: string;
  onPick: (file: File) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentMeta[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  /** Calcula a posição do painel a partir do botão (viewport, não do DOM pai). */
  const computePos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(PANEL_MAX_WIDTH, window.innerWidth * 0.9);
    const left = Math.min(
      Math.max(8, r.right - width), // alinhado à direita do botão
      window.innerWidth - width - 8, // sem estourar a borda direita da tela
    );
    setPos({ top: r.bottom + 4, left: Math.max(8, left), width });
  };

  const toggle = () => {
    if (!open) {
      setItems(listRecents(category)); // lê na abertura (lista fresca)
      setVisibleCount(PAGE_SIZE);
      computePos();
    }
    setOpen((o) => !o);
  };

  // reposiciona se a tela girar/redimensionar enquanto o painel está aberto
  useEffect(() => {
    if (!open) return;
    const onResize = () => computePos();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // paginação: sentinel no fim da lista visível carrega +PAGE_SIZE ao entrar
  // no viewport do painel (scroll interno, root = a própria lista)
  useEffect(() => {
    if (!open || visibleCount >= items.length) return;
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(items.length, c + PAGE_SIZE));
        }
      },
      { root }, // sem rootMargin: só carrega quando o sentinel REALMENTE entra na área visível
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [open, items, visibleCount]);

  const pick = async (m: RecentMeta) => {
    setOpen(false);
    try {
      const blob = await getRecentBlob(m.id);
      if (!blob) {
        // bytes já não existem (limpeza externa) → remove a entrada fantasma
        await removeRecent(category, m.id);
        toast.error("Arquivo não está mais disponível no histórico");
        return;
      }
      onPick(new File([blob], m.name, { type: m.mime }));
    } catch (e) {
      toast.error(`Erro ao abrir recente: ${e instanceof Error ? e.message : e}`);
    }
  };

  const clear = async () => {
    await clearRecents(category);
    setItems([]);
  };

  const visible = items.slice(0, visibleCount);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label="Histórico"
        title="Histórico"
        data-recents-button=""
        onClick={toggle}
        className="p-1 text-slate-300"
      >
        <History size={18} />
      </button>
      {open && pos &&
        createPortal(
          <>
            {/* backdrop: tap fora fecha o painel */}
            <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
            <div
              data-recents-panel=""
              className="fixed bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-[9999] flex flex-col overflow-hidden"
              style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: "60vh" }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
                <span className="text-xs font-medium text-slate-300">Recentes</span>
                {items.length > 0 && (
                  <button
                    type="button"
                    data-recents-clear=""
                    onClick={clear}
                    className="flex items-center gap-1 text-xs text-slate-500"
                  >
                    <Trash2 size={12} /> Limpar
                  </button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="px-3 py-4 text-xs text-slate-500 text-center">
                  Nenhum arquivo recente
                </p>
              ) : (
                <ul
                  ref={scrollRef}
                  className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/60"
                >
                  {visible.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        data-recents-item=""
                        onClick={() => void pick(m)}
                        className="w-full text-left px-3 py-2 active:bg-slate-800"
                      >
                        <span className="block text-sm truncate">{m.name}</span>
                        <span className="block text-xs text-slate-500">
                          {fmtDate(m.ts)} · {formatBytes(m.size)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {visibleCount < items.length && (
                    <li
                      ref={sentinelRef}
                      data-recents-sentinel=""
                      className="px-3 py-2 text-center text-xs text-slate-500"
                    >
                      Carregando…
                    </li>
                  )}
                </ul>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};
export default RecentsButton;
