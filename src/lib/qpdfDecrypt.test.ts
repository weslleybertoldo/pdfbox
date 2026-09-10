import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { createQpdfRunner, type QpdfFactory, type QpdfRunner } from "./qpdfRunner";
import { decryptWithQpdf } from "./qpdfDecrypt";
import { protectedPdfBytes } from "./pdfErrors.test";

// Roda o qpdf-wasm REAL em Node (mesmo glue/binário do app; só a URL do .wasm
// muda: caminho em node_modules em vez do asset do Vite).
const require = createRequire(import.meta.url);
const glue = require.resolve("@neslinesli93/qpdf-wasm");
const wasmPath = path.join(path.dirname(glue), "qpdf.wasm");

const hasEncryptDict = (bytes: Uint8Array) =>
  new TextDecoder("latin1").decode(bytes).includes("/Encrypt");

let runner: QpdfRunner;
beforeAll(async () => {
  const factory = require(glue) as QpdfFactory;
  runner = await createQpdfRunner(factory, wasmPath);
});

describe("decryptWithQpdf (qpdf-wasm real)", () => {
  it("senha de usuário certa → PDF novo sem /Encrypt", () => {
    const r = decryptWithQpdf(runner, protectedPdfBytes(), "senha123");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new TextDecoder().decode(r.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(hasEncryptDict(protectedPdfBytes())).toBe(true);
    expect(hasEncryptDict(r.bytes)).toBe(false);
  });

  it("senha errada / sem senha → wrong-password (sem gerar saída)", () => {
    const wrong = decryptWithQpdf(runner, protectedPdfBytes(), "errada");
    expect(wrong).toMatchObject({ ok: false, reason: "wrong-password" });
    const none = decryptWithQpdf(runner, protectedPdfBytes(), "");
    expect(none).toMatchObject({ ok: false, reason: "wrong-password" });
  });

  it("só senha de dono → decifra sem senha nenhuma", () => {
    const plain = decryptWithQpdf(runner, protectedPdfBytes(), "senha123");
    if (!plain.ok) throw new Error("fixture não abriu");
    const enc = runner.run(
      ["--encrypt", "--owner-password=dono456", "--bits=256", "--", "in.pdf", "out.pdf"],
      { "in.pdf": plain.bytes },
      ["out.pdf"],
    );
    expect(enc.code).toBe(0);
    const ownerOnly = enc.files["out.pdf"];
    expect(ownerOnly && hasEncryptDict(ownerOnly)).toBe(true);
    const r = decryptWithQpdf(runner, ownerOnly!, "");
    expect(r.ok).toBe(true);
    if (r.ok) expect(hasEncryptDict(r.bytes)).toBe(false);
  });

  it("bytes que não são PDF → error com detalhe", () => {
    const r = decryptWithQpdf(runner, new TextEncoder().encode("isso não é um pdf"), "");
    expect(r).toMatchObject({ ok: false, reason: "error" });
  });

  it("chamadas repetidas reaproveitam o runtime (sem vazar arquivos)", () => {
    for (let i = 0; i < 3; i++) {
      expect(decryptWithQpdf(runner, protectedPdfBytes(), "senha123").ok).toBe(true);
    }
  });
});
