import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import {
  getFavorites,
  listShareTargets,
  sortForConfig,
  toggleFavorite,
  type ShareTargetApp,
} from "../lib/shareTargets";
import { AppIcon } from "./ShareMenu";

/**
 * Tela "Compartilhamento escolhido" (engrenagem do rodapé da Home): lista
 * TODOS os apps do aparelho que aceitam receber arquivos, com checkbox.
 * Marcados no TOPO (ordem de marcação), demais em ordem alfabética; a lista
 * é re-buscada do nativo a cada abertura (ícones/apps sempre atuais) e a
 * seleção persiste em localStorage (shareTargets.favorites).
 */
const ShareTargetsConfig = ({ onClose }: { onClose: () => void }) => {
  const [apps, setApps] = useState<ShareTargetApp[] | null>(null);
  const [error, setError] = useState(false);
  const [favs, setFavs] = useState<string[]>(() => getFavorites());
  const [query, setQuery] = useState("");

  useEffect(() => {
    listShareTargets()
      .then((list) => setApps(sortForConfig(list)))
      .catch(() => setError(true));
  }, []);

  const handleToggle = (pkg: string) => {
    setFavs(toggleFavorite(pkg));
    // re-sort: marcado sobe pro topo, desmarcado volta pra ordem alfabética
    setApps((cur) => (cur ? sortForConfig(cur) : cur));
  };

  const q = query.trim().toLowerCase();
  const visible = apps?.filter((a) => !q || a.label.toLowerCase().includes(q));

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60" data-share-config>
      <div className="absolute inset-x-0 bottom-0 top-16 bg-slate-950 border-t border-slate-700 rounded-t-2xl flex flex-col max-w-lg mx-auto">
        <div className="flex items-center gap-3 p-4 pb-2">
          <h2 className="flex-1 text-base font-semibold">Compartilhamento escolhido</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="p-1">
            <X size={20} />
          </button>
        </div>
        <p className="px-4 pb-2 text-xs text-slate-500">
          Marque seus apps favoritos — eles aparecem como atalho no "Compartilhar escolhido".
        </p>
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
            <Search size={14} className="text-slate-500 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar app…"
              aria-label="Buscar app"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
          {error ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              Não foi possível listar os apps do aparelho
            </p>
          ) : visible === undefined ? (
            <p className="text-sm text-slate-500 py-4 text-center">Carregando…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">Nenhum app encontrado</p>
          ) : (
            visible.map((app) => (
              <label
                key={app.packageName}
                data-config-app={app.packageName}
                className="flex items-center gap-3 px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer active:bg-slate-800"
              >
                <AppIcon app={app} />
                <span className="flex-1 text-sm truncate">{app.label}</span>
                <input
                  type="checkbox"
                  checked={favs.includes(app.packageName)}
                  onChange={() => handleToggle(app.packageName)}
                  aria-label={`Favoritar ${app.label}`}
                  className="w-5 h-5 accent-blue-500 shrink-0"
                />
              </label>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ShareTargetsConfig;
