import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { backAction, isExternalEntry } from "../lib/backAction";

/**
 * Botão voltar do Android + popup "Deseja sair?" (regra em lib/backAction).
 * "Sim" fecha a activity: aberto por outro app, volta pra ele (a activity do
 * PDFBox fica por cima da dele quando o arquivo chega pelo Compartilhar);
 * aberto pelo ícone, fecha o app. "Não" (ou tocar fora) fica onde está.
 */
const AndroidBack = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  // o listener nativo é registrado uma vez e lê o estado atual por aqui
  const current = useRef({ location, asking });
  useEffect(() => {
    current.current = { location, asking };
  }, [location, asking]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener("backButton", ({ canGoBack }) => {
      const { location: loc, asking: open } = current.current;
      const action = backAction({
        dialogOpen: open,
        atHome: loc.pathname === "/",
        externalEntry: isExternalEntry(loc.state),
        canGoBack,
      });
      if (action === "close-dialog") setAsking(false);
      else if (action === "ask-exit") setAsking(true);
      else if (action === "go-back") window.history.back();
      else navigate("/", { replace: true });
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [navigate]);

  // trocou de tela com o popup aberto (ex.: chegou outro arquivo) → fecha
  useEffect(() => {
    setAsking(false);
  }, [location.key]);

  if (!asking) return null;
  return (
    <div
      data-exit-dialog
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-dialog-title"
      onClick={() => setAsking(false)}
      className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-4"
      >
        <p id="exit-dialog-title" className="text-base font-medium text-center">
          Deseja sair?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-exit-no
            onClick={() => setAsking(false)}
            className="flex-1 py-2 bg-slate-700 rounded-lg text-sm active:bg-slate-600"
          >
            Não
          </button>
          <button
            type="button"
            data-exit-yes
            onClick={() => void CapApp.exitApp()}
            className="flex-1 py-2 bg-blue-600 rounded-lg text-sm font-medium active:bg-blue-500"
          >
            Sim
          </button>
        </div>
      </div>
    </div>
  );
};

export default AndroidBack;
