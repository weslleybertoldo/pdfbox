import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Settings, Share2, Star } from "lucide-react";
import { toast } from "sonner";
import {
  listShareTargets,
  resolveFavorites,
  shareGeneral,
  shareTargetsAvailable,
  shareToApp,
  type SharePayload,
  type ShareTargetApp,
} from "../lib/shareTargets";

/** Ícone do app (PNG base64 do nativo) com placeholder pra ícone vazio. */
export const AppIcon = ({ app, size = 32 }: { app: ShareTargetApp; size?: number }) =>
  app.icon ? (
    <img
      src={`data:image/png;base64,${app.icon}`}
      alt=""
      width={size}
      height={size}
      className="rounded-lg shrink-0"
    />
  ) : (
    <span
      className="rounded-lg shrink-0 bg-slate-700 flex items-center justify-center text-sm font-medium"
      style={{ width: size, height: size }}
    >
      {app.label.charAt(0).toUpperCase()}
    </span>
  );

/**
 * Mini-menu de compartilhamento: "geral" (chooser nativo, fluxo atual) e
 * "escolhido" (favoritos → intent direcionado, sem chooser). Fora do Android
 * nativo (e sem o mock de testes) não há menu — o trigger cai direto no
 * comportamento web atual (download). O trigger é render-prop pra cada tela
 * manter o próprio estilo de botão.
 */
const ShareMenu = ({ payload, children }: {
  payload: SharePayload;
  children: (open: () => void) => ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [chosenOpen, setChosenOpen] = useState(false);
  const [favorites, setFavorites] = useState<ShareTargetApp[] | null>(null);
  const navigate = useNavigate();

  const close = () => {
    setOpen(false);
    setChosenOpen(false);
  };

  const handleTrigger = () => {
    if (!shareTargetsAvailable()) {
      void shareGeneral(payload).catch(() => {/* usuário fechou a share sheet */});
      return;
    }
    setFavorites(null);
    setChosenOpen(false);
    setOpen(true);
  };

  const handleGeneral = () => {
    close();
    void shareGeneral(payload).catch(() => {/* usuário fechou a share sheet */});
  };

  const handleChosen = () => {
    setChosenOpen(true);
    if (favorites === null) {
      listShareTargets()
        .then((apps) => setFavorites(resolveFavorites(apps)))
        .catch(() => {
          setFavorites([]);
          toast.error("Não foi possível listar os apps");
        });
    }
  };

  const handleApp = async (app: ShareTargetApp) => {
    close();
    try {
      await shareToApp(app, payload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao compartilhar");
    }
  };

  const goToConfig = () => {
    close();
    navigate("/", { state: { openShareConfig: true } });
  };

  return (
    <>
      {children(handleTrigger)}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" data-share-menu>
            <button
              type="button"
              aria-label="Fechar"
              onClick={close}
              className="absolute inset-0 bg-black/60"
            />
            <div className="absolute bottom-0 inset-x-0 bg-slate-900 border-t border-slate-700 rounded-t-2xl p-4 space-y-2 max-w-lg mx-auto">
              <p className="text-sm font-medium pb-1">Compartilhar</p>
              <button
                type="button"
                data-share-general
                onClick={handleGeneral}
                className="w-full flex items-center gap-3 px-3 py-3 bg-slate-800 rounded-xl text-sm text-left"
              >
                <Share2 size={18} className="text-blue-400 shrink-0" />
                <span>
                  Compartilhar geral
                  <span className="block text-xs text-slate-500">Todos os apps</span>
                </span>
              </button>
              <button
                type="button"
                data-share-chosen
                onClick={handleChosen}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-left ${
                  chosenOpen ? "bg-blue-600/20 border border-blue-500/50" : "bg-slate-800"
                }`}
              >
                <Star size={18} className="text-blue-400 shrink-0" />
                <span>
                  Compartilhar escolhido
                  <span className="block text-xs text-slate-500">Seus apps favoritos</span>
                </span>
              </button>
              {chosenOpen && (
                <div className="pt-1 space-y-1" data-share-favorites>
                  {favorites === null ? (
                    <p className="text-xs text-slate-500 px-3 py-2">Carregando…</p>
                  ) : favorites.length === 0 ? (
                    <div className="px-3 py-2 space-y-2">
                      <p className="text-xs text-slate-400">
                        Configure seus apps na engrenagem da tela inicial
                      </p>
                      <button
                        type="button"
                        data-share-config-cta
                        onClick={goToConfig}
                        className="flex items-center gap-2 px-3 py-2 bg-blue-600 rounded-lg text-xs font-medium"
                      >
                        <Settings size={14} /> Configurar apps
                      </button>
                    </div>
                  ) : (
                    favorites.map((app) => (
                      <button
                        key={app.packageName}
                        type="button"
                        data-share-app={app.packageName}
                        onClick={() => void handleApp(app)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-left active:bg-slate-800"
                      >
                        <AppIcon app={app} />
                        <span className="truncate">{app.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default ShareMenu;
