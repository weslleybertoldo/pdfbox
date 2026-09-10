import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LockOpen, Loader2 } from "lucide-react";
import {
  crackPassword,
  estimateCrack,
  DEFAULT_MAX_DIGITS,
  type CrackEstimate,
} from "../lib/passwordCrack";

/** "~10 min", "menos de 1 min", "~2 h" a partir de segundos. */
function fmtEta(seconds: number): string {
  if (!isFinite(seconds)) return "tempo indeterminado";
  if (seconds < 60) return "menos de 1 min";
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
  const h = seconds / 3600;
  return h < 10 ? `~${h.toFixed(1)} h` : "várias horas";
}

/** mm:ss do cronômetro (00:01, 00:02, …). */
function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Popup de Descobrir senha: dupla confirmação com o tempo MEDIDO neste
 * aparelho/PDF (não texto fixo) → barra de progresso com cronômetro correndo e
 * botão cancelar. Ao achar, entrega a senha e a cópia já sem senha.
 */
const DiscoverPassword = ({ bytes, fileName, onFound, onCancel, onNotFound, onUnsupported }: {
  bytes: Uint8Array;
  fileName: string;
  onFound: (password: string, decrypted: Uint8Array) => void;
  onCancel: () => void;
  onNotFound: () => void;
  onUnsupported: () => void;
}) => {
  const [stage, setStage] = useState<"estimating" | "confirm" | "running">("estimating");
  const [estimate, setEstimate] = useState<CrackEstimate | null>(null);
  const [percent, setPercent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const maxDigits = DEFAULT_MAX_DIGITS;

  // estima ao abrir (calibra a velocidade real); handler não suportado degrada
  useEffect(() => {
    let alive = true;
    void estimateCrack(bytes, { maxDigits, fileName }).then((e) => {
      if (!alive) return;
      if (!e.supported) { onUnsupported(); return; }
      setEstimate(e);
      setStage("confirm");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cronômetro durante a busca
  useEffect(() => {
    if (stage !== "running") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const start = () => {
    setStage("running");
    setPercent(0);
    setElapsed(0);
    const ac = new AbortController();
    abortRef.current = ac;
    void crackPassword(bytes, { maxDigits, fileName }, {
      signal: ac.signal,
      onProgress: (tried, total) => setPercent(total > 0 ? Math.min(100, (tried / total) * 100) : 0),
    }).then((r) => {
      if (r.status === "found") onFound(r.password, r.bytes);
      else if (r.status === "not-found") onNotFound();
      else if (r.status === "unsupported") onUnsupported();
      else if (r.status === "cancelled") onCancel();
      else onNotFound(); // erro raro → trata como não encontrada, volta pro campo
    });
  };

  const cancel = () => {
    abortRef.current?.abort();
    onCancel();
  };

  return createPortal(
    <div data-discover-popup className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
        <p className="text-sm font-medium flex items-center gap-2">
          <LockOpen size={18} className="text-blue-400" /> Descobrir senha
        </p>

        {stage === "estimating" && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
            <Loader2 size={16} className="animate-spin" /> Calculando o tempo neste aparelho…
          </div>
        )}

        {stage === "confirm" && estimate && (
          <>
            <p className="text-sm text-slate-300">
              Vou tentar senhas comuns, datas e números de até {maxDigits} dígitos.
            </p>
            <p className="text-sm text-slate-300">
              Neste PDF, pode levar até <span className="font-semibold text-white">{fmtEta(estimate.etaSeconds)}</span>.
              Se a senha estiver nesse conjunto, encontro antes.
            </p>
            <p className="text-xs text-slate-500">
              Só faz sentido para os seus próprios documentos. Senha longa e aleatória não é encontrada.
            </p>
            <div className="flex gap-2 pt-1">
              <button type="button" data-discover-no onClick={onCancel}
                className="flex-1 py-2 bg-slate-700 rounded-lg text-sm">
                Não
              </button>
              <button type="button" data-discover-yes onClick={start}
                className="flex-1 py-2 bg-blue-600 rounded-lg text-sm font-medium">
                Sim, descobrir
              </button>
            </div>
          </>
        )}

        {stage === "running" && (
          <>
            <div className="flex flex-col items-center gap-2 py-2">
              <span data-discover-clock className="text-3xl font-semibold tabular-nums text-white">
                {fmtClock(elapsed)}
              </span>
              <span className="text-xs text-slate-400">Procurando a senha…</span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div data-discover-bar className="h-full bg-blue-500 transition-all duration-200"
                style={{ width: `${percent}%` }} />
            </div>
            <button type="button" data-discover-cancel onClick={cancel}
              className="w-full py-2 bg-slate-700 rounded-lg text-sm">
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default DiscoverPassword;
