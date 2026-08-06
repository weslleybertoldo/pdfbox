import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import ProgressBar from "../components/ProgressBar";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import RecentsButton from "../components/RecentsButton";
import { pickFiles, readFileAsBytes } from "../lib/files";
import { consumeActionFile, actionFileToFile } from "../lib/actionFile";
import { addRecent } from "../lib/recents";
import { compressPdfLight, compressPdfStrong, type CompressMode } from "../lib/convert/compress";

const MODES: { id: CompressMode; label: string; desc: string }[] = [
  { id: "leve", label: "Leve", desc: "Mantém texto selecionável" },
  { id: "media", label: "Média", desc: "Páginas viram imagem" },
  { id: "forte", label: "Forte", desc: "Máxima redução" },
];

const CompressPdf = () => {
  const [mode, setMode] = useState<CompressMode>("media");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ResultFile[] | null>(null);
  const [sizeBefore, setSizeBefore] = useState(0);
  // arquivo pré-carregado (botão de ações do viewer) — dispensa o picker
  const [preFile, setPreFile] = useState<File | null>(null);

  // consumo único no mount; tipo errado (não-PDF) é descartado silenciosamente
  useEffect(() => {
    const af = consumeActionFile();
    if (af?.mimeType === "application/pdf") setPreFile(actionFileToFile(af));
  }, []);

  /** Comprime (picker ou histórico); sucesso registra a entrada no histórico. */
  const runCompress = async (f: File) => {
    setResult(null);
    setSizeBefore(f.size);
    setProgress(0);
    try {
      const bytes = await readFileAsBytes(f);
      const out = mode === "leve"
        ? await compressPdfLight(bytes)
        : await compressPdfStrong(bytes, mode, (d, t) => setProgress((d / t) * 100));
      // .slice() garante Uint8Array<ArrayBuffer> (BlobPart exige isso, não ArrayBufferLike genérico)
      setResult([{ blob: new Blob([out.slice()], { type: "application/pdf" }),
        name: f.name.replace(/\.pdf$/i, "-comprimido.pdf"), collection: "downloads" }]);
      void addRecent("compress-pdf", { name: f.name, mime: f.type || "application/pdf", blob: f });
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : e}`);
    } finally {
      setProgress(null);
    }
  };

  const handlePick = async () => {
    const [f] = await pickFiles("application/pdf");
    if (!f) return;
    await runCompress(f);
  };

  /** Com arquivo pré-carregado, o picker vira "trocar": substitui sem rodar. */
  const handleSwap = async () => {
    const [f] = await pickFiles("application/pdf");
    if (!f) return;
    setPreFile(f);
    setResult(null);
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
          <ArrowLeft size={16} /> Voltar
        </Link>
        <RecentsButton category="compress-pdf" onPick={(f) => void runCompress(f)} />
      </div>
      <h2 className="text-lg font-semibold">Comprimir PDF</h2>
      <div className="space-y-2">
        {MODES.map((m) => (
          <button key={m.id} type="button" onClick={() => setMode(m.id)}
            className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm ${
              mode === m.id ? "border-blue-500 bg-blue-600/10" : "border-slate-800"}`}>
            <span className="font-medium">{m.label}</span>
            <span className="block text-xs text-slate-500">{m.desc}</span>
          </button>
        ))}
      </div>
      {preFile && (
        <div data-preloaded-file
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm truncate">
          Arquivo: {preFile.name}
        </div>
      )}
      {progress !== null ? (
        <ProgressBar percent={progress} label={`Comprimindo ${Math.round(progress)}%`} />
      ) : preFile ? (
        <>
          <button type="button" onClick={() => void runCompress(preFile)}
            className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
            Comprimir
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
      {result && <ResultPanel files={result} sizeBefore={sizeBefore} />}
    </div>
  );
};
export default CompressPdf;
