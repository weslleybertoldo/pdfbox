import { useState } from "react";
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

/**
 * Ícone de histórico + painel dropdown com os últimos arquivos usados na
 * função (categoria). Tap num item reconstrói o File e entrega no onPick —
 * o fluxo da tela roda com ele como entrada, sem abrir o picker.
 */
const RecentsButton = ({ category, onPick }: {
  category: string;
  onPick: (file: File) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentMeta[]>([]);

  const toggle = () => {
    if (!open) setItems(listRecents(category)); // lê na abertura (lista fresca)
    setOpen((o) => !o);
  };

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

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Histórico"
        title="Histórico"
        data-recents-button=""
        onClick={toggle}
        className="p-1 text-slate-300"
      >
        <History size={18} />
      </button>
      {open && (
        <>
          {/* backdrop: tap fora fecha o painel */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            data-recents-panel=""
            className="absolute right-0 top-full mt-1 w-72 max-w-[85vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-30 overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
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
              <ul className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
                {items.map((m) => (
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
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};
export default RecentsButton;
