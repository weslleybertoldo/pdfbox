import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Camera as CameraIcon, X } from "lucide-react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { toast } from "sonner";
import ResultPanel, { type ResultFile } from "../components/ResultPanel";
import { imagesToPdf } from "../lib/convert/imagesToPdf";
import { applyFilter, FILTERS, type FilterId } from "../lib/scanFilters";

interface Shot { dataUrl: string; filter: FilterId }

/** Aplica o filtro num dataURL via canvas e devolve JPEG bytes. */
async function filteredJpeg(shot: Shot): Promise<Uint8Array> {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = shot.dataUrl; });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyFilter(data.data, shot.filter);
  ctx.putImageData(data, 0, 0);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.85),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Preview pequeno com filtro aplicado (350px) pra lista. */
async function previewWithFilter(dataUrl: string, filter: FilterId): Promise<string> {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const scale = 350 / img.naturalWidth;
  const canvas = document.createElement("canvas");
  canvas.width = 350;
  canvas.height = img.naturalHeight * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyFilter(data.data, filter);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.8);
}

const Scan = () => {
  const [shots, setShots] = useState<Shot[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile[] | null>(null);

  const takePhoto = async () => {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: 90,
      });
      if (!photo.dataUrl) return;
      const shot: Shot = { dataUrl: photo.dataUrl, filter: "original" };
      setShots((s) => [...s, shot]);
      setPreviews((p) => [...p, photo.dataUrl!]);
      setResult(null);
    } catch { /* usuário cancelou a câmera */ }
  };

  const setFilter = async (i: number, filter: FilterId) => {
    setShots((s) => s.map((sh, j) => (j === i ? { ...sh, filter } : sh)));
    const preview = await previewWithFilter(shots[i].dataUrl, filter);
    setPreviews((p) => p.map((pv, j) => (j === i ? preview : pv)));
  };

  const generatePdf = async () => {
    setBusy(true);
    try {
      const pages = await Promise.all(shots.map(filteredJpeg));
      const pdf = await imagesToPdf(pages.map((bytes) => ({ bytes, type: "image/jpeg" })));
      setResult([{ blob: new Blob([pdf.slice()], { type: "application/pdf" }),
        name: `digitalizado-${new Date().toISOString().slice(0, 10)}.pdf`,
        collection: "downloads" }]);
    } catch (e) {
      toast.error(`Falha ao gerar PDF: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400">
        <ArrowLeft size={16} /> Voltar
      </Link>
      <h2 className="text-lg font-semibold">Digitalizar</h2>
      {shots.map((shot, i) => (
        <div key={i} className="bg-slate-900 rounded-xl p-3 space-y-2">
          <div className="flex items-start gap-2">
            <img src={previews[i]} alt={`Página ${i + 1}`} className="w-24 rounded" />
            <span className="text-xs text-slate-400 flex-1">Página {i + 1}</span>
            <button type="button" onClick={() => {
              setShots((s) => s.filter((_, j) => j !== i));
              setPreviews((p) => p.filter((_, j) => j !== i));
            }}><X size={16} /></button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(i, f.id)}
                className={`px-2 py-1 rounded text-[11px] border ${
                  shot.filter === f.id ? "bg-blue-600 border-blue-600" : "border-slate-700 text-slate-400"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" onClick={takePhoto}
        className="w-full py-3 border border-dashed border-slate-700 rounded-xl text-sm text-slate-300 flex items-center justify-center gap-2">
        <CameraIcon size={16} /> {shots.length ? "Tirar outra foto" : "Tirar foto"}
      </button>
      {shots.length > 0 && (
        <button type="button" onClick={generatePdf} disabled={busy}
          className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium">
          {busy ? "Gerando PDF..." : `Gerar PDF (${shots.length} página${shots.length === 1 ? "" : "s"})`}
        </button>
      )}
      {result && <ResultPanel files={result} />}
    </div>
  );
};
export default Scan;
