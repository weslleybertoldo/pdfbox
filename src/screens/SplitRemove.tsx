import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import PageGrid from "../components/PageGrid";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import RecentsButton from "../components/RecentsButton";
import { pickFiles, readFileAsBytes } from "../lib/files";
import { addRecent } from "../lib/recents";
import { loadPdf, renderThumbnails, destroyPdf } from "../lib/pdfRender";
import { extractPages } from "../lib/pdfOps";
import { splitSelection } from "../lib/pageSelection";

const SplitRemove = () => {
  const { mode } = useParams(); // "split" | "remove"
  const isSplit = mode === "split";
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [name, setName] = useState("");
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile[] | null>(null);

  /** Abre um PDF (picker ou histórico); sucesso na abertura registra no histórico. */
  const openFile = async (f: File) => {
    setBusy(true);
    try {
      const b = await readFileAsBytes(f);
      setBytes(b);
      setName(f.name.replace(/\.pdf$/i, ""));
      const doc = await loadPdf(b);
      try {
        setThumbs(await renderThumbnails(doc));
      } finally {
        await destroyPdf(doc);
      }
      setSelected(new Set());
      setResult(null);
      void addRecent("pages", { name: f.name, mime: f.type || "application/pdf", blob: f });
    } catch (e) {
      toast.error(`Erro ao abrir PDF: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async () => {
    const [f] = await pickFiles("application/pdf");
    if (!f) return;
    await openFile(f);
  };

  const handleRun = async () => {
    if (!bytes || selected.size === 0) return;
    setBusy(true);
    try {
      const { selected: sel, rest } = splitSelection(thumbs.length, [...selected]);
      const files: ResultFile[] = [];
      if (isSplit) {
        // 2 PDFs: selecionadas + restantes
        files.push({ blob: new Blob([(await extractPages(bytes, sel)).slice()], { type: "application/pdf" }),
          name: `${name}-selecionadas.pdf`, collection: "downloads" });
        if (rest.length)
          files.push({ blob: new Blob([(await extractPages(bytes, rest)).slice()], { type: "application/pdf" }),
            name: `${name}-restante.pdf`, collection: "downloads" });
      } else {
        // remover: seleção = páginas que FICAM
        files.push({ blob: new Blob([(await extractPages(bytes, sel)).slice()], { type: "application/pdf" }),
          name: `${name}-editado.pdf`, collection: "downloads" });
      }
      setResult(files);
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
          <ArrowLeft size={16} /> Voltar
        </Link>
        <RecentsButton category="pages" onPick={(f) => void openFile(f)} />
      </div>
      <h2 className="text-lg font-semibold">{isSplit ? "Dividir PDF" : "Remover páginas"}</h2>
      <p className="text-xs text-slate-400">
        {isSplit
          ? "Marque as páginas a separar — sai um PDF com elas e outro com o restante."
          : "Marque as páginas que FICAM — as demais são removidas."}
      </p>
      {!thumbs.length ? (
        <button type="button" onClick={handlePick} disabled={busy}
          className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
          {busy ? "Abrindo..." : "Escolher PDF"}
        </button>
      ) : (
        <>
          <PageGrid thumbs={thumbs} selected={selected}
            onToggle={(p) => setSelected((s) => {
              const n = new Set(s);
              if (n.has(p)) n.delete(p); else n.add(p);
              return n;
            })} />
          <button type="button" onClick={handleRun} disabled={busy || selected.size === 0}
            className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium disabled:opacity-40">
            {busy ? "Processando..." : isSplit
              ? `Dividir (${selected.size} selecionada${selected.size === 1 ? "" : "s"})`
              : `Manter ${selected.size} página${selected.size === 1 ? "" : "s"}`}
          </button>
        </>
      )}
      {result && <ResultPanel files={result} />}
    </div>
  );
};
export default SplitRemove;
