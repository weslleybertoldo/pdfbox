import { createWorker } from "tesseract.js";
import { Document, Packer, Paragraph, TextRun } from "docx";

/**
 * corePath aponta pro arquivo .js específico (não um diretório) para evitar a
 * detecção automática de SIMD/relaxed-SIMD do tesseract.js escolher uma
 * variante que não empacotamos (ex.: tesseract-core-relaxedsimd-lstm.wasm.js).
 * "-simd-lstm" cobre o baseline de WebView Android moderno (SIMD, oem LSTM_ONLY)
 * com o menor payload; validado offline via smoke test real (worker.min.js +
 * tesseract-core-simd-lstm.wasm(.js) + tessdata por/eng.traineddata).
 *
 * tessdata é servido DESCOMPRIMIDO (gzip:false): o aapt do Android descompacta
 * e renomeia assets .gz dentro do APK (por.traineddata.gz -> por.traineddata),
 * então gzip:true levaria 404 e travaria o OCR em 0% pra sempre.
 */
const CORE_PATH = "/tesseract/tesseract-core-simd-lstm.wasm.js";
const WORKER_PATH = "/tesseract/worker.min.js";
const LANG_PATH = "/tessdata";

/** OCR offline (por+eng empacotados) → .docx com o texto editável. */
export async function imageToDocxViaOcr(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ blob: Blob; text: string }> {
  // Guard anti-trava: o aapt do Android descompacta/renomeia assets .gz no APK
  // (dist/tessdata/por.traineddata.gz vira assets/public/tessdata/por.traineddata).
  // Com gzip:true o tesseract pediria o .gz, levaria 404 e travaria em 0% pra
  // sempre. Falha explícita aqui em vez disso.
  const head = await fetch(`${LANG_PATH}/por.traineddata`, { method: "HEAD" });
  if (!head.ok) throw new Error("dados de OCR não encontrados");

  const worker = await createWorker(["por", "eng"], 1, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    gzip: false,
    logger: (m) => {
      if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(file);
    const text = data.text.trim();
    const paragraphs = text
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({ sections: [{ children: paragraphs }] });
    return { blob: await Packer.toBlob(doc), text };
  } finally {
    await worker.terminate();
  }
}
