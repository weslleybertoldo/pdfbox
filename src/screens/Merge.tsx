import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { toast } from "sonner";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import { pickFiles, readFileAsBytes } from "../lib/files";
import { mergePdfs } from "../lib/pdfOps";

const Merge = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile[] | null>(null);

  const add = async () => {
    const picked = await pickFiles("application/pdf", true);
    if (picked.length) { setFiles((f) => [...f, ...picked]); setResult(null); }
  };
  const move = (i: number, dir: -1 | 1) =>
    setFiles((f) => {
      const n = [...f];
      const j = i + dir;
      if (j < 0 || j >= n.length) return f;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const handleMerge = async () => {
    setBusy(true);
    try {
      const inputs = await Promise.all(files.map(readFileAsBytes));
      const merged = await mergePdfs(inputs);
      setResult([{ blob: new Blob([merged.slice()], { type: "application/pdf" }),
        name: "juntado.pdf", collection: "downloads" }]);
    } catch (e) {
      toast.error(`Falha ao juntar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
        <ArrowLeft size={16} /> Voltar
      </Link>
      <h2 className="text-lg font-semibold">Juntar PDFs</h2>
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`}
          className="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-2 text-sm">
          <span className="flex-1 truncate">{i + 1}. {f.name}</span>
          <button type="button" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
          <button type="button" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
          <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add}
        className="w-full py-2.5 border border-dashed border-slate-700 rounded-xl text-sm text-slate-400 flex items-center justify-center gap-1">
        <Plus size={14} /> Adicionar PDF
      </button>
      <button type="button" onClick={handleMerge} disabled={busy || files.length < 2}
        className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium disabled:opacity-40">
        {busy ? "Juntando..." : `Juntar ${files.length} PDFs`}
      </button>
      {result && <ResultPanel files={result} />}
    </div>
  );
};
export default Merge;
