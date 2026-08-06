import { describe, it, expect } from "vitest";
import {
  isPasswordError,
  isWrongPasswordError,
  passwordProtectedError,
  NEED_PASSWORD,
  INCORRECT_PASSWORD,
} from "./pdfErrors";

// Fixture: PDF de 3 páginas cifrado com AES-256 (pikepdf R=6),
// user password "senha123", owner password "dono456".
export const PROTECTED_PDF_B64 =
  "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cyA8ZGI1OWYyZDcxMjllY2MxODFjNzFkNTNlOTc2OWZjNWY+IC9SIDYgL1N0bUYgL1N0ZENGIC9TdHJGIC9TdGRDRiAvVSA8NDQ0N2JkNjY1ZmI4ZGUxYmUyYjE0ZmM1MjFlNzk3OGE2YWE3NzA3M2Q4NDJjZjFiMzQwOWZhNDZiNDVmZDk5MDY0NmUzOTIzNWQyOTIyOTA0MjkxNDIxMTAxZWYzZmJhPiAvVUUgPDAxYTYzYjJkMzIyM2Q5OGNlOGUyYTZkODk4MDBmZGM1ZGE4YTMzMjg2ZjliNWUyNTRiNzUwNWE2NDAwODZjZWE+IC9WIDUgPj4KZW5kb2JqCjEzIDAgb2JqCjw8IC9UeXBlIC9YUmVmIC9MZW5ndGggNDYgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0RlY29kZVBhcm1zIDw8IC9Db2x1bW5zIDQgL1ByZWRpY3RvciAxMiA+PiAvVyBbIDEgMiAxIF0gL0luZm8gNCAwIFIgL1Jvb3QgMSAwIFIgL1NpemUgMTQgL0lEIFs8MjE5M2ZkMzhiODRmYmYwNWZjNWIwNDEwZTY5MzkxZjk+PDIxOTNmZDM4Yjg0ZmJmMDVmYzViMDQxMGU2OTM5MWY5Pl0gL0VuY3J5cHQgMTIgMCBSID4+CnN0cmVhbQp4nGNiAAImRgZ+BiYGhmIQqwHEYmDESvxnmvqbiYFRAqiEURJGMKszAAB6MwQuCmVuZHN0cmVhbQplbmRvYmoKc3RhcnR4cmVmCjIwNTYKJSVFT0YK";

export const protectedPdfBytes = (): Uint8Array =>
  Uint8Array.from(atob(PROTECTED_PDF_B64), (c) => c.charCodeAt(0));

const fakePwdErr = (code: number): Error => {
  const e = new Error("x");
  e.name = "PasswordException";
  (e as Error & { code: number }).code = code;
  return e;
};

describe("pdfErrors", () => {
  it("códigos hardcoded batem com o PasswordResponses do pdfjs-dist instalado", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(pdfjs.PasswordResponses.NEED_PASSWORD).toBe(NEED_PASSWORD);
    expect(pdfjs.PasswordResponses.INCORRECT_PASSWORD).toBe(INCORRECT_PASSWORD);
  });

  it("isPasswordError: reconhece PasswordException (e só ele)", () => {
    expect(isPasswordError(fakePwdErr(NEED_PASSWORD))).toBe(true);
    expect(isPasswordError(fakePwdErr(INCORRECT_PASSWORD))).toBe(true);
    expect(isPasswordError(passwordProtectedError())).toBe(true);
    expect(isPasswordError(new Error("No password given"))).toBe(false);
    expect(isPasswordError(null)).toBe(false);
    expect(isPasswordError(undefined)).toBe(false);
    expect(isPasswordError("PasswordException")).toBe(false);
  });

  it("isWrongPasswordError: só code 2 (senha incorreta)", () => {
    expect(isWrongPasswordError(fakePwdErr(INCORRECT_PASSWORD))).toBe(true);
    expect(isWrongPasswordError(fakePwdErr(NEED_PASSWORD))).toBe(false);
    expect(isWrongPasswordError(passwordProtectedError())).toBe(false);
    expect(isWrongPasswordError(new Error("x"))).toBe(false);
  });

  it("pdf.js real: sem senha → code 1; errada → code 2; certa → abre (3 pgs)", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = protectedPdfBytes();
    const load = (password?: string) =>
      pdfjs.getDocument({ data: bytes.slice(), password }).promise;

    const noPwd = await load().then(() => null, (e: unknown) => e);
    expect(isPasswordError(noPwd)).toBe(true);
    expect(isWrongPasswordError(noPwd)).toBe(false);

    const wrongPwd = await load("errada").then(() => null, (e: unknown) => e);
    expect(isPasswordError(wrongPwd)).toBe(true);
    expect(isWrongPasswordError(wrongPwd)).toBe(true);

    const doc = await load("senha123");
    expect(doc.numPages).toBe(3);
    await doc.loadingTask.destroy();
  });
});
