/**
 * Word 97-2003 (.doc) → .docx no próprio aparelho, sem internet.
 *
 * Usa o x2t do ONLYOFFICE compilado pra WebAssembly (build da CryptPad,
 * AGPL-3.0; `public/x2t/`, baixado no build por `scripts/fetch-x2t.mjs`)
 * num Worker clássico (`public/x2t/x2t-worker.js`). O .docx que sai segue o
 * caminho "Word fiel" de sempre (viewer, Word → PDF, Word → Imagem) — só o
 * .doc passa por aqui; .docx, PDF e imagem não mudam.
 *
 * O worker é criado por conversão e encerrado no fim: o conversor ocupa
 * dezenas de MB e o .doc é raro, então não fica nada vivo à toa.
 */
import { DOCX_MIME, isLegacyDocFile } from "../files";

/** .docx de verdade é um ZIP ("PK\x03\x04") — às vezes chega com nome .doc. */
export const isZip = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** "relatorio.doc" → "relatorio.docx"; nome sem .doc ganha .docx no fim. */
export const docxName = (name: string): string =>
  /\.doc$/i.test(name) ? name.replace(/\.doc$/i, ".docx") : `${name}.docx`;

/** Tempo máximo de uma conversão (1ª vez inclui compilar o conversor). */
export const TEMPO_MAX_MS = 120_000;

interface RespostaWorker {
  id: number;
  ok: boolean;
  bytes?: ArrayBuffer;
  erro?: string;
}

let seq = 0;

/** URL do worker — relativa ao documento (https://localhost/ no app, / no dev). */
const workerUrl = (): string => new URL("x2t/x2t-worker.js", document.baseURI).href;

const erroConversao = (motivo?: string) =>
  new Error(`não foi possível converter este .doc${motivo ? ` (${motivo})` : ""}`);

/** Bytes de um Word antigo → bytes de .docx. ZIP (já é .docx) volta igual. */
export function docToDocx(bytes: Uint8Array): Promise<Uint8Array> {
  if (isZip(bytes)) return Promise.resolve(bytes);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl());
    } catch {
      reject(erroConversao("o conversor não iniciou"));
      return;
    }
    const id = ++seq;
    let timer = 0;
    const fim = (acao: () => void) => {
      window.clearTimeout(timer);
      worker.terminate();
      acao();
    };
    timer = window.setTimeout(
      () => fim(() => reject(erroConversao("demorou demais"))),
      TEMPO_MAX_MS,
    );
    worker.onmessage = (e: MessageEvent<RespostaWorker>) => {
      const m = e.data;
      if (m.id !== id) return;
      fim(() =>
        m.ok && m.bytes ? resolve(new Uint8Array(m.bytes)) : reject(erroConversao(m.erro)),
      );
    };
    worker.onerror = (e) => {
      e.preventDefault();
      fim(() => reject(erroConversao(e.message || "falha no conversor")));
    };
    const copia = bytes.slice().buffer;
    worker.postMessage({ id, bytes: copia }, [copia]);
  });
}

/** File de Word → File .docx: o .doc é convertido; o .docx passa direto. */
export async function wordAsDocx(file: File): Promise<File> {
  if (!isLegacyDocFile(file.name, file.type)) return file;
  const docx = await docToDocx(new Uint8Array(await file.arrayBuffer()));
  return new File([docx.slice()], docxName(file.name), { type: DOCX_MIME });
}
