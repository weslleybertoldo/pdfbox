import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import RecentsButton from "../components/RecentsButton";
import { pickFiles, IMG_ACCEPT } from "../lib/files";
import { consumeActionFile, actionFileToFile } from "../lib/actionFile";
import { addRecent } from "../lib/recents";
import { compressImage, type CompressMode } from "../lib/convert/compress";

const MODES: { id: CompressMode; label: string; desc: string }[] = [
  { id: "leve", label: "Leve", desc: "Menor compressão, mais qualidade" },
  { id: "media", label: "Média", desc: "Equilíbrio entre tamanho e qualidade" },
  { id: "forte", label: "Forte", desc: "Máxima redução" },
];

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, "");

const CompressImage = () => {
  const [mode, setMode] = useState<CompressMode>("media");
  const [fmt, setFmt] = useState<"png" | "jpg">("jpg");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile[] | null>(null);
  const [sizeBefore, setSizeBefore] = useState(0);
  // arquivo pré-carregado (botão de ações do viewer) — dispensa o picker
  const [preFile, setPreFile] = useState<File | null>(null);

  // consumo único no mount; tipo errado (não-imagem) é descartado silenciosamente
  useEffect(() => {
    const af = consumeActionFile();
    if (af?.mimeType.startsWith("image/")) setPreFile(actionFileToFile(af));
  }, []);

  /** Comprime (picker ou histórico); sucesso registra a entrada no histórico. */
  const runCompress = async (f: File) => {
    setResult(null);
    setSizeBefore(f.size);
    setBusy(true);
    try {
      const blob = await compressImage(f, mode, fmt);
      setResult([{ blob, name: `${baseName(f)}-comprimido.${fmt}`, collection: "images" }]);
      void addRecent("compress-image", { name: f.name, mime: f.type, blob: f });
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async () => {
    const [f] = await pickFiles(IMG_ACCEPT);
    if (!f) return;
    await runCompress(f);
  };

  /** Com arquivo pré-carregado, o picker vira "trocar": substitui sem rodar. */
  const handleSwap = async () => {
    const [f] = await pickFiles(IMG_ACCEPT);
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
        <RecentsButton category="compress-image" onPick={(f) => void runCompress(f)} />
      </div>
      <h2 className="text-lg font-semibold">Comprimir imagem</h2>
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
      <div className="flex gap-2">
        {(["png", "jpg"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFmt(f)}
            className={`px-4 py-1.5 rounded-lg text-sm border ${
              fmt === f ? "bg-blue-600 border-blue-600" : "border-slate-700 text-slate-400"}`}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      {preFile && (
        <div data-preloaded-file
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm truncate">
          Arquivo: {preFile.name}
        </div>
      )}
      {preFile ? (
        <>
          <button type="button" onClick={() => void runCompress(preFile)} disabled={busy}
            className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium disabled:opacity-40">
            {busy ? "Comprimindo..." : "Comprimir"}
          </button>
          <button type="button" onClick={handleSwap} disabled={busy}
            className="w-full py-2.5 border border-slate-700 rounded-xl text-sm text-slate-400 disabled:opacity-40">
            Escolher outra imagem
          </button>
        </>
      ) : (
        <button type="button" onClick={handlePick} disabled={busy}
          className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium disabled:opacity-40">
          {busy ? "Comprimindo..." : "Escolher imagem"}
        </button>
      )}
      {result && <ResultPanel files={result} sizeBefore={sizeBefore} />}
    </div>
  );
};
export default CompressImage;
