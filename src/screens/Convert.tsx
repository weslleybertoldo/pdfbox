import { useState, useEffect } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import ProgressBar from "../components/ProgressBar";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import RecentsButton from "../components/RecentsButton";
import { pickFiles, readFileAsBytes, isDocxFile, DOCX_MIME, IMG_ACCEPT } from "../lib/files";
import { consumeActionFile, actionFileToFile } from "../lib/actionFile";
import { addRecent } from "../lib/recents";
import { isPasswordError, PASSWORD_PROTECTED_MSG } from "../lib/pdfErrors";
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

// MIME pro histórico quando o File vem sem type (picker de algumas ROMs/apps
// entrega .docx/.xlsx/.html com type "") — deduz pela extensão do accept.
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: DOCX_MIME,
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  html: "text/html",
  htm: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const mimeFor = (f: File): string =>
  f.type || EXT_MIME[f.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";

/** O arquivo (vindo do viewer) serve pra esta ação? — compara com o accept. */
const acceptsFile = (accept: string, name: string, mime: string): boolean =>
  accept.split(",").some((a) =>
    a === ".docx" ? isDocxFile(name, mime) : a.includes("/") && a === mime);

const Convert = () => {
  const { action = "" } = useParams();
  const cfg = ACTIONS[action];
  const [fmt, setFmt] = useState<Fmt>(() => defaultFmt(action));
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ResultFile[] | null>(null);
  // arquivo pré-carregado (botão de ações do viewer) — dispensa o picker
  const [preFiles, setPreFiles] = useState<File[] | null>(null);
  const location = useLocation();

  // HashRouter não remonta a tela ao trocar só o :action (mesmo Route/element) —
  // reseta formato padrão e resultado ao navegar entre conversões distintas.
  useEffect(() => {
    setFmt(defaultFmt(action));
    setResult(null);
    setProgress(null);
    setPreFiles(null);
  }, [action]);

  // Arquivo entregue pelo viewer ("usar em…"): consumo único a cada navegação;
  // tipo incompatível com a ação é descartado silenciosamente (fica o picker).
  useEffect(() => {
    const af = consumeActionFile();
    if (af && ACTIONS[action] && acceptsFile(ACTIONS[action].accept, af.name, af.mimeType)) {
      setPreFiles([actionFileToFile(af)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  if (!cfg) return <p className="p-8 text-center">Ação desconhecida.</p>;

  /** Roda a conversão (picker ou histórico); sucesso registra as entradas. */
  const runConvert = async (files: File[]) => {
    setResult(null);
    setProgress(0);
    try {
      setResult(await cfg.run(files, fmt, setProgress));
      for (const f of files) {
        void addRecent(`convert:${action}`, { name: f.name, mime: mimeFor(f), blob: f });
      }
    } catch (e) {
      // PDF protegido: mensagem amigável (o prompt de senha existe só no viewer)
      toast.error(isPasswordError(e)
        ? PASSWORD_PROTECTED_MSG
        : `Falha na conversão: ${e instanceof Error ? e.message : e}`);
    } finally {
      setProgress(null);
    }
  };

  const handlePick = async () => {
    const files = await pickFiles(cfg.accept, cfg.multiple);
    if (!files.length) return;
    await runConvert(files);
  };

  /** Com arquivo pré-carregado, o picker vira "trocar": substitui sem rodar. */
  const handleSwap = async () => {
    const files = await pickFiles(cfg.accept, cfg.multiple);
    if (!files.length) return;
    setPreFiles(files);
    setResult(null);
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
          <ArrowLeft size={16} /> Voltar
        </Link>
        <RecentsButton category={`convert:${action}`} onPick={(f) => void runConvert([f])} />
      </div>
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
      {preFiles && (
        <div data-preloaded-file
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm truncate">
          Arquivo{preFiles.length > 1 ? "s" : ""}: {preFiles.map((f) => f.name).join(", ")}
        </div>
      )}
      {progress !== null ? (
        <ProgressBar percent={progress} label={`Convertendo ${Math.round(progress)}%`} />
      ) : preFiles ? (
        <>
          <button type="button" onClick={() => void runConvert(preFiles)}
            className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
            Converter
          </button>
          <button type="button" onClick={handleSwap}
            className="w-full py-2.5 border border-slate-700 rounded-xl text-sm text-slate-400">
            Escolher outro arquivo
          </button>
        </>
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
