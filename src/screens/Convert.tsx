import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import ProgressBar from "../components/ProgressBar";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import { pickFiles, readFileAsBytes, IMG_ACCEPT } from "../lib/files";
import { pdfToImages } from "../lib/convert/pdfToImages";
import { imagesToPdf } from "../lib/convert/imagesToPdf";
import { pdfToDocx } from "../lib/convert/pdfToDocx";
import { imageToDocxViaOcr } from "../lib/convert/ocrToDocx";
import { docxToPdf, docxToImages } from "../lib/convert/docxToPdf";
import { htmlFileToPdf, htmlFileToImages } from "../lib/convert/htmlFile";
import { xlsxToPdf, xlsxToImages } from "../lib/convert/xlsxPipeline";

type Fmt = "png" | "jpg";
const baseName = (f: File) => f.name.replace(/\.[^.]+$/, "");

interface ActionCfg {
  title: string;
  accept: string;
  multiple?: boolean;
  askFormat?: boolean; // saída PNG/JPG?
  run: (files: File[], fmt: Fmt, onP: (p: number) => void) => Promise<ResultFile[]>;
}

const pdfBlob = (bytes: Uint8Array, name: string): ResultFile => ({
  // .slice() garante Uint8Array<ArrayBuffer> (BlobPart exige isso, não ArrayBufferLike genérico)
  blob: new Blob([bytes.slice()], { type: "application/pdf" }), name, collection: "downloads",
});
const docxFile = (blob: Blob, name: string): ResultFile => ({
  blob, name, collection: "downloads",
});
const imgFiles = (imgs: { blob: Blob; name: string }[]): ResultFile[] =>
  imgs.map((i) => ({ ...i, collection: "images" as const }));

const ACTIONS: Record<string, ActionCfg> = {
  "pdf-to-image": {
    title: "PDF → Imagem", accept: "application/pdf", askFormat: true,
    run: async ([f], fmt, onP) =>
      imgFiles(await pdfToImages(await readFileAsBytes(f), baseName(f), fmt,
        undefined, (d, t) => onP((d / t) * 100))),
  },
  "pdf-to-word": {
    title: "PDF → Word", accept: "application/pdf",
    run: async ([f], _fmt, onP) =>
      [docxFile(await pdfToDocx(await readFileAsBytes(f), (d, t) => onP((d / t) * 100)),
        `${baseName(f)}.docx`)],
  },
  "image-to-pdf": {
    title: "Imagem → PDF", accept: IMG_ACCEPT, multiple: true,
    run: async (files) => {
      const inputs = await Promise.all(files.map(async (f) => ({
        bytes: await readFileAsBytes(f), type: f.type,
      })));
      return [pdfBlob(await imagesToPdf(inputs), `${baseName(files[0])}.pdf`)];
    },
  },
  "image-to-word": {
    title: "Imagem → Word (OCR)", accept: IMG_ACCEPT,
    run: async ([f], _fmt, onP) => {
      const { blob, text } = await imageToDocxViaOcr(f, onP);
      if (!text) toast.warning("Nenhum texto encontrado na imagem.");
      return [docxFile(blob, `${baseName(f)}.docx`)];
    },
  },
  "word-to-pdf": {
    title: "Word → PDF", accept: ".docx",
    run: async ([f]) => [pdfBlob(await docxToPdf(f), `${baseName(f)}.pdf`)],
  },
  "word-to-image": {
    title: "Word → Imagem", accept: ".docx", askFormat: true,
    run: async ([f], fmt) => imgFiles(await docxToImages(f, baseName(f), fmt)),
  },
  "html-to-pdf": {
    title: "HTML → PDF/Imagem", accept: ".html,.htm", askFormat: true,
    run: async ([f], fmt) =>
      fmt === "png"
        ? imgFiles(await htmlFileToImages(f, baseName(f), "png"))
        : [pdfBlob(await htmlFileToPdf(f), `${baseName(f)}.pdf`)],
  },
  "xlsx-to-pdf": {
    title: "Excel → PDF/Imagem", accept: ".xlsx", askFormat: true,
    run: async ([f], fmt) =>
      fmt === "png"
        ? imgFiles(await xlsxToImages(f, baseName(f), "png"))
        : [pdfBlob(await xlsxToPdf(f), `${baseName(f)}.pdf`)],
  },
};

const defaultFmt = (action: string): Fmt =>
  action.includes("html") || action.includes("xlsx") ? "jpg" : "png";

const Convert = () => {
  const { action = "" } = useParams();
  const cfg = ACTIONS[action];
  const [fmt, setFmt] = useState<Fmt>(() => defaultFmt(action));
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ResultFile[] | null>(null);

  // HashRouter não remonta a tela ao trocar só o :action (mesmo Route/element) —
  // reseta formato padrão e resultado ao navegar entre conversões distintas.
  useEffect(() => {
    setFmt(defaultFmt(action));
    setResult(null);
    setProgress(null);
  }, [action]);

  if (!cfg) return <p className="p-8 text-center">Ação desconhecida.</p>;

  const handlePick = async () => {
    const files = await pickFiles(cfg.accept, cfg.multiple);
    if (!files.length) return;
    setResult(null);
    setProgress(0);
    try {
      setResult(await cfg.run(files, fmt, setProgress));
    } catch (e) {
      toast.error(`Falha na conversão: ${e instanceof Error ? e.message : e}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
        <ArrowLeft size={16} /> Voltar
      </Link>
      <h2 className="text-lg font-semibold">{cfg.title}</h2>
      {cfg.askFormat && (
        <div className="flex gap-2">
          {(["png", "jpg"] as const).map((f) => (
            <button key={f} type="button" onClick={() => { setFmt(f); setResult(null); }}
              className={`px-4 py-1.5 rounded-lg text-sm border ${
                fmt === f ? "bg-blue-600 border-blue-600" : "border-slate-700 text-slate-400"}`}>
              {action.includes("html") || action.includes("xlsx")
                ? f === "png" ? "Imagem" : "PDF"
                : f.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {progress !== null ? (
        <ProgressBar percent={progress} label={`Convertendo ${Math.round(progress)}%`} />
      ) : (
        <button type="button" onClick={handlePick}
          className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
          Escolher arquivo{cfg.multiple ? "s" : ""}
        </button>
      )}
      {result && <ResultPanel files={result} />}
    </div>
  );
};
export default Convert;
