import { Download, Eye, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { saveToDevice } from "../lib/mediaSaver";
import { formatBytes, DOCX_MIME } from "../lib/files";
import { setOpenFile } from "../lib/openFileStore";
import ShareMenu from "./ShareMenu";

export interface ResultFile {
  blob: Blob;
  name: string;
  collection: "downloads" | "images" | "video";
}

/** O viewer renderiza PDF, imagem e Word — xlsx não ganha "Visualizar". */
const isViewable = (f: ResultFile) =>
  f.blob.type === "application/pdf" ||
  f.blob.type.startsWith("image/") ||
  f.blob.type === DOCX_MIME;

/** sizeBefore: mostra "antes → depois" (compressões). */
const ResultPanel = ({ files, sizeBefore }: { files: ResultFile[]; sizeBefore?: number }) => {
  const navigate = useNavigate();
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
  // múltiplos arquivos: visualiza o primeiro (v1 — simples)
  const handleView = async () => {
    const f = files[0];
    try {
      setOpenFile({
        bytes: new Uint8Array(await f.blob.arrayBuffer()),
        name: f.name,
        mimeType: f.blob.type,
      });
      navigate("/viewer");
    } catch (e) {
      toast.error(`Erro ao visualizar: ${e instanceof Error ? e.message : e}`);
    }
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
        <ShareMenu payload={{ kind: "blobs", files: files.map((f) => ({ blob: f.blob, name: f.name })) }}>
          {(open) => (
            <button type="button" onClick={open}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-700 rounded-lg text-sm">
              <Share2 size={16} /> Compartilhar
            </button>
          )}
        </ShareMenu>
        {isViewable(files[0]) && (
          <button type="button" onClick={handleView}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-700 rounded-lg text-sm">
            <Eye size={16} /> Visualizar
          </button>
        )}
      </div>
    </div>
  );
};
export default ResultPanel;
