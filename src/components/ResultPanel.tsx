import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { saveToDevice } from "../lib/mediaSaver";
import { shareBlob, formatBytes } from "../lib/files";

export interface ResultFile {
  blob: Blob;
  name: string;
  collection: "downloads" | "images" | "video";
}

/** sizeBefore: mostra "antes → depois" (compressões). */
const ResultPanel = ({ files, sizeBefore }: { files: ResultFile[]; sizeBefore?: number }) => {
  const total = files.reduce((s, f) => s + f.blob.size, 0);

  const handleSave = async () => {
    const results = await Promise.allSettled(
      files.map((f) => saveToDevice(f.blob, f.name, f.collection)),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - ok;
    if (fail === 0) {
      toast.success(files.length > 1 ? `${files.length} arquivos salvos` : "Arquivo salvo");
    } else if (ok === 0) {
      toast.error("Falha ao salvar os arquivos");
    } else {
      toast.warning(`${ok} salvos, ${fail} falharam`);
    }
  };
  const handleShare = async () => {
    try {
      for (const f of files) await shareBlob(f.blob, f.name);
    } catch { /* usuário fechou a share sheet */ }
  };

  return (
    <div className="bg-slate-900 border border-green-800/50 rounded-xl p-4 space-y-3">
      <p className="text-sm">
        {files.length > 1 ? `${files.length} arquivos gerados` : files[0].name}
      </p>
      <p className="text-xs text-slate-400">
        {sizeBefore ? `${formatBytes(sizeBefore)} → ${formatBytes(total)}` : formatBytes(total)}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={handleSave}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 rounded-lg text-sm">
          <Download size={16} /> Salvar
        </button>
        <button type="button" onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-700 rounded-lg text-sm">
          <Share2 size={16} /> Compartilhar
        </button>
      </div>
    </div>
  );
};
export default ResultPanel;
