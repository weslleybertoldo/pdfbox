import { describe, it, expect } from "vitest";
import {
  formatBytes, isLegacyDocFile, isWordFile, DOC_MIME, DOCX_MIME, WORD_ACCEPT,
} from "./files";

describe("formatBytes", () => {
  it("formata bytes, KB e MB", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3.5 * 1024 ** 2)).toBe("3.5 MB");
  });
});

describe("Word: .docx e .doc (Word 97-2003)", () => {
  it("reconhece o .doc pela extensão ou pelo MIME", () => {
    expect(isLegacyDocFile("formulario.doc", "")).toBe(true);
    expect(isLegacyDocFile("FORMULARIO.DOC", "")).toBe(true);
    expect(isLegacyDocFile("sem-extensao", DOC_MIME)).toBe(true);
  });
  it(".docx não é Word antigo (nem com MIME errado)", () => {
    expect(isLegacyDocFile("relatorio.docx", "")).toBe(false);
    expect(isLegacyDocFile("relatorio.docx", DOC_MIME)).toBe(false);
    expect(isLegacyDocFile("x", DOCX_MIME)).toBe(false);
  });
  it("isWordFile aceita os dois e recusa o resto", () => {
    expect(isWordFile("a.docx", "")).toBe(true);
    expect(isWordFile("a.doc", "")).toBe(true);
    expect(isWordFile("a.pdf", "application/pdf")).toBe(false);
    expect(isWordFile("a.docm", "")).toBe(false);
  });
  it("o accept do seletor lista MIME e extensão dos dois", () => {
    expect(WORD_ACCEPT.split(",")).toEqual([DOCX_MIME, ".docx", DOC_MIME, ".doc"]);
  });
});
