import { describe, expect, it } from "vitest";
import { scaleLineHeightCss } from "./lineHeight";

describe("scaleLineHeightCss", () => {
  it("line-height sem unidade (regra auto do Word) vira múltiplo da altura natural da fonte", () => {
    // formato que a docx-preview gera (estilo padrão do documento, com \r\n)
    expect(scaleLineHeightCss(".docxv p {\r\n  margin-bottom: 8.00pt;\r\n  line-height: 1.08;\r\n}")).toBe(
      ".docxv p {\r\n  margin-bottom: 8.00pt;\r\n  line-height: calc(1.08 * var(--docxv-lh, 1));\r\n}",
    );
    expect(scaleLineHeightCss("p{line-height:1.5}")).toBe("p{line-height: calc(1.5 * var(--docxv-lh, 1))}");
  });

  it("não mexe em entrelinha exata/mínima (pt), em normal nem no que já foi convertido", () => {
    const css = "p{line-height: 18pt;} q{line-height:normal} r{line-height: calc(1.5 * var(--docxv-lh, 1));}";
    expect(scaleLineHeightCss(css)).toBe(css);
  });
});
