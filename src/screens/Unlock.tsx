import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, LockOpen } from "lucide-react";
import { toast } from "sonner";
import ProgressBar from "../components/ProgressBar";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import RecentsButton from "../components/RecentsButton";
import { pickFiles, readFileAsBytes } from "../lib/files";
import { consumeActionFile, actionFileToFile } from "../lib/actionFile";
import { addRecent } from "../lib/recents";
import { unlockPdf, unlockedName } from "../lib/pdfUnlock";

/**
 * Remover senha: gera uma CÓPIA do PDF sem criptografia (qpdf `--decrypt`),
 * que abre em qualquer app sem pedir senha. PDF só com senha de dono sai
 * direto; com senha de usuário, pede a senha (uma vez) — a senha nunca é
 * gravada. Arquivo pré-carregado vem do botão de funções do viewer, que
 * repassa também a senha já digitada lá (ActionFile.password) pra não pedir
 * duas vezes.
 */
const Unlock = () => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile[] | null>(null);
  const [preFile, setPreFile] = useState<File | null>(null);
  const [prePassword, setPrePassword] = useState<string | undefined>(undefined);
  const [pwdAsk, setPwdAsk] = useState<{ file: File; wrong: boolean } | null>(null);
  const [pwdValue, setPwdValue] = useState("");

  // consumo único no mount; tipo errado (não-PDF) é descartado silenciosamente
  useEffect(() => {
    const af = consumeActionFile();
    if (af?.mimeType === "application/pdf") {
      setPreFile(actionFileToFile(af));
      setPrePassword(af.password);
    }
  }, []);

  const runUnlock = async (f: File, password?: string) => {
    setResult(null);
    setBusy(true);
    try {
      const bytes = await readFileAsBytes(f);
      const r = await unlockPdf(bytes, password);
      if (r.status === "not-encrypted") {
        setPwdAsk(null);
        toast.info("Este PDF não tem senha");
        return;
      }
      if (r.status === "needs-password") {
        setPwdAsk({ file: f, wrong: r.wrong });
        setPwdValue("");
        return;
      }
      if (r.status === "error") {
        toast.error(`Falha ao remover a senha: ${r.message}`);
        return;
      }
      setPwdAsk(null);
      setPwdValue("");
      // .slice() garante Uint8Array<ArrayBuffer> (BlobPart exige isso)
      setResult([{
        blob: new Blob([r.bytes.slice()], { type: "application/pdf" }),
        name: unlockedName(f.name),
        collection: "downloads",
      }]);
      void addRecent("unlock", { name: f.name, mime: f.type || "application/pdf", blob: f });
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      setPrePassword(undefined); // a senha do viewer vale só pra 1ª tentativa
    }
  };

  const handlePick = async () => {
    const [f] = await pickFiles("application/pdf");
    if (!f) return;
    await runUnlock(f);
  };

  /** Com arquivo pré-carregado, o picker vira "trocar": substitui sem rodar. */
  const handleSwap = async () => {
    const [f] = await pickFiles("application/pdf");
    if (!f) return;
    setPreFile(f);
    setPrePassword(undefined);
    setResult(null);
  };

  const submitPwd = () => {
    if (!pwdAsk || !pwdValue || busy) return;
    void runUnlock(pwdAsk.file, pwdValue);
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
          <ArrowLeft size={16} /> Voltar
        </Link>
        <RecentsButton category="unlock" onPick={(f) => void runUnlock(f)} />
      </div>
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <LockOpen size={20} className="text-blue-400" /> Remover senha
      </h2>
      <p className="text-sm text-slate-400">
        Gera uma cópia do PDF sem senha, que abre em qualquer app. A senha é usada só
        pra abrir o arquivo — não fica guardada.
      </p>
      {preFile && (
        <div data-preloaded-file
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm truncate">
          Arquivo: {preFile.name}
        </div>
      )}
      {busy ? (
        <div className="animate-pulse">
          <ProgressBar percent={100} label="Removendo senha…" />
        </div>
      ) : preFile ? (
        <>
          <button type="button" data-unlock-run onClick={() => void runUnlock(preFile, prePassword)}
            className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
            Remover senha
          </button>
          <button type="button" onClick={handleSwap}
            className="w-full py-2.5 border border-slate-700 rounded-xl text-sm text-slate-400">
            Escolher outro PDF
          </button>
        </>
      ) : (
        <button type="button" onClick={handlePick}
          className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
          Escolher PDF
        </button>
      )}
      {result && <ResultPanel files={result} />}
      {pwdAsk && (
        <div
          data-pwd-dialog
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
        >
          <div className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium">PDF protegido — digite a senha</p>
            <p className="text-xs text-slate-400 truncate">{pwdAsk.file.name}</p>
            <input
              type="password"
              autoFocus
              value={pwdValue}
              onChange={(e) => setPwdValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPwd();
                if (e.key === "Escape") setPwdAsk(null);
              }}
              placeholder="Senha"
              aria-label="Senha do PDF"
              className="w-full px-3 py-2 bg-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            {pwdAsk.wrong && (
              <p data-pwd-wrong className="text-xs text-red-400">
                Senha incorreta, tente novamente
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPwdAsk(null)}
                className="flex-1 py-2 bg-slate-700 rounded-lg text-sm">
                Cancelar
              </button>
              <button type="button" disabled={!pwdValue || busy} onClick={submitPwd}
                className="flex-1 py-2 bg-blue-600 rounded-lg text-sm font-medium disabled:opacity-40">
                Remover senha
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default Unlock;
