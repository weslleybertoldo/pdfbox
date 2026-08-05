import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import ProgressBar from "../components/ProgressBar";
import ShareMenu from "../components/ShareMenu";
import { formatBytes } from "../lib/files";
import { saveFileFromPath } from "../lib/mediaSaver";
import { isNativeAndroid, pickAndCompressVideo } from "../lib/videoCompressor";
import type { CompressMode } from "../lib/convert/compress";

const MODES: { id: CompressMode; label: string; desc: string }[] = [
  { id: "leve", label: "Leve", desc: "1080p" },
  { id: "media", label: "Média", desc: "720p" },
  { id: "forte", label: "Forte", desc: "480p" },
];

interface CompressedVideo {
  path: string;
  inputSize: number;
  outputSize: number;
}

const CompressVideo = () => {
  const [mode, setMode] = useState<CompressMode>("media");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<CompressedVideo | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePick = async () => {
    setResult(null);
    setProgress(0);
    try {
      setResult(await pickAndCompressVideo(mode, setProgress));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== "cancelled") toast.error(`Falha: ${message}`);
    } finally {
      setProgress(null);
    }
  };

  const handleSave = async () => {
    if (!result || busy) return;
    setBusy(true);
    try {
      await saveFileFromPath(result.path, `video-comprimido-${Date.now()}.mp4`, "video/mp4", "video");
      toast.success("Vídeo salvo");
    } catch (e) {
      toast.error(`Falha ao salvar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
        <ArrowLeft size={16} /> Voltar
      </Link>
      <h2 className="text-lg font-semibold">Comprimir vídeo</h2>
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
      {!isNativeAndroid() ? (
        <p className="text-sm text-slate-500 text-center py-3">Disponível só no app Android</p>
      ) : progress !== null ? (
        <ProgressBar percent={progress} label={`Comprimindo ${Math.round(progress)}%`} />
      ) : (
        <button type="button" onClick={handlePick}
          className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
          Escolher vídeo
        </button>
      )}
      {result && (
        <div className="bg-slate-900 border border-green-800/50 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-400">
            {result.inputSize > 0
              ? `${formatBytes(result.inputSize)} → ${formatBytes(result.outputSize)}`
              : formatBytes(result.outputSize)}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 rounded-lg text-sm disabled:opacity-40">
              <Download size={16} /> Salvar
            </button>
            <ShareMenu payload={{
              kind: "path", path: result.path,
              fileName: `video-comprimido-${Date.now()}.mp4`, mimeType: "video/mp4",
            }}>
              {(open) => (
                <button type="button" onClick={open} disabled={busy}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-700 rounded-lg text-sm disabled:opacity-40">
                  <Share2 size={16} /> Compartilhar
                </button>
              )}
            </ShareMenu>
          </div>
        </div>
      )}
    </div>
  );
};
export default CompressVideo;
