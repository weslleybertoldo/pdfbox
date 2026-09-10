import { describe, it, expect } from "vitest";
import { makePasswordChecker, parseEncryption } from "./pdfCrypto";
import { CRYPTO_FIXTURES, fixtureBytes } from "./pdfCryptoFixtures";
import { protectedPdfBytes } from "./pdfErrors.test";

// Fixtures ESTÁTICAS (geradas e verificadas pelo qpdf em gen-crypto-fixtures.cjs)
// + o R6 embutido no pdfErrors.test. Gerar in-process no vitest era instável
// (o qpdf-wasm tem estado global e corrompia a saída entre chamadas).
describe("pdfCrypto — verificador de senha de usuário", () => {
  for (const c of CRYPTO_FIXTURES) {
    it(`${c.key} (R${c.r}): detecta o handler, aceita a senha certa e rejeita erradas`, () => {
      const bytes = fixtureBytes(c.b64);
      const info = parseEncryption(bytes);
      expect(info, "parse do /Encrypt").not.toBeNull();
      expect(info!.r).toBe(c.r);
      const check = makePasswordChecker(bytes);
      expect(check, "verificador").not.toBeNull();
      expect(check!(c.pw), `deveria aceitar '${c.pw}'`).toBe(true);
      for (const wrong of [c.pw + "0", c.pw.slice(0, -1) + "9", "000000", "senha", ""]) {
        if (wrong === c.pw) continue;
        expect(check!(wrong), `deveria rejeitar '${wrong}'`).toBe(false);
      }
    });
  }

  it("R6 AES-256 embutido (senha123)", () => {
    const info = parseEncryption(protectedPdfBytes());
    expect(info!.r).toBe(6);
    const check = makePasswordChecker(protectedPdfBytes());
    expect(check).not.toBeNull();
    expect(check!("senha123")).toBe(true);
    expect(check!("senha124")).toBe(false);
    expect(check!("12345678")).toBe(false);
  });

  it("PDF sem criptografia → parse null (degrada pra digitação manual)", () => {
    const plain = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
    expect(parseEncryption(plain)).toBeNull();
    expect(makePasswordChecker(plain)).toBeNull();
  });
});
