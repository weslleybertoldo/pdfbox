import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";
import JSZip from "jszip";
import { docxName, isZip } from "./docToDocx";

describe("docToDocx — utilitários", () => {
  it("isZip reconhece .docx (ZIP) e recusa .doc (OLE2)", () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(isZip(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(false);
    expect(isZip(new Uint8Array([0x50]))).toBe(false);
  });
  it("docxName troca só a extensão .doc", () => {
    expect(docxName("2 - FORMULÁRIO FUNDESP.doc")).toBe("2 - FORMULÁRIO FUNDESP.docx");
    expect(docxName("RELATORIO.DOC")).toBe("RELATORIO.docx");
    expect(docxName("sem-extensao")).toBe("sem-extensao.docx");
  });
});

const X2T = resolve(__dirname, "../../../public/x2t");
const BASE = "http://pdfbox.teste/x2t/";

interface Resposta {
  id: number;
  ok: boolean;
  bytes?: ArrayBuffer;
  erro?: string;
}

/**
 * Roda o public/x2t/x2t-worker.js DE VERDADE (o mesmo arquivo que vai no APK)
 * num "worker" de mentira: um contexto vm com importScripts/fetch/postMessage
 * que leem de public/x2t/. Prova o caminho inteiro .doc → .docx sem navegador.
 */
function workerDeTeste() {
  let responder: (m: Resposta) => void = () => {};
  const ctx: Record<string, unknown> = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    performance,
    crypto: globalThis.crypto,
    navigator: {},
    WorkerGlobalScope: function WorkerGlobalScope() {},
    location: { href: `${BASE}x2t-worker.js` },
    postMessage: (m: Resposta) => responder(m),
    fetch: async (url: string) => {
      const nome = String(url).slice(BASE.length);
      const buf = readFileSync(join(X2T, nome));
      return {
        ok: true,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    },
  };
  ctx.self = ctx;
  ctx.importScripts = (nome: string) =>
    vm.runInContext(readFileSync(join(X2T, nome), "utf8"), ctx, { filename: nome });
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(X2T, "x2t-worker.js"), "utf8"), ctx, {
    filename: "x2t-worker.js",
  });
  let id = 0;
  return (bytes: Uint8Array) =>
    new Promise<Resposta>((ok) => {
      responder = ok;
      (ctx.onmessage as (e: { data: unknown }) => void)({
        data: { id: ++id, bytes: bytes.slice().buffer },
      });
    });
}

describe("x2t-worker.js (conversor do .doc, offline)", () => {
  it("converte um Word 97-2003 em .docx com o texto e a tabela", async () => {
    const converter = workerDeTeste();
    const doc = new Uint8Array(readFileSync(join(__dirname, "__fixtures__/word97.doc")));
    const r = await converter(doc);
    expect(r.erro).toBeUndefined();
    expect(r.ok).toBe(true);
    const docx = new Uint8Array(r.bytes!);
    expect(isZip(docx)).toBe(true);
    const zip = await JSZip.loadAsync(docx);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("PDFBox");
    expect(xml).toContain("Word 97-2003");
    expect(xml).toMatch(/<w:tbl>/);
    expect(xml).toContain("06/11/2026");
    // 2ª conversão no mesmo worker (o FS é reaproveitado e limpo entre pedidos)
    const r2 = await converter(doc);
    expect(r2.ok).toBe(true);
  }, 60_000);

  it("arquivo que não é Word volta com erro, sem travar", async () => {
    const converter = workerDeTeste();
    const r = await converter(new TextEncoder().encode("isto não é um documento do Word"));
    expect(r.ok).toBe(false);
    expect(typeof r.erro).toBe("string");
  }, 60_000);
});
