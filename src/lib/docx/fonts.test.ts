import { describe, expect, it } from "vitest";
import { DOCX_FONT_FILES, familiesIn, fontFaceCss, fontsBase } from "./fonts";

describe("fontes do Word", () => {
  it("gera 4 @font-face por nome do Word, apontando pro woff2 da fonte livre", () => {
    const css = fontFaceCss("https://localhost/fonts/docx/");
    expect(css.match(/@font-face/g)).toHaveLength(Object.keys(DOCX_FONT_FILES).length * 4);
    expect(css).toContain('font-family:"Times New Roman";font-weight:700;font-style:italic');
    expect(css).toContain('url("https://localhost/fonts/docx/Tinos-BoldItalic.woff2")');
    expect(css).toContain('font-family:"Calibri"');
    expect(css).toContain("PDFBoxSansC-Regular.woff2");
  });

  it("resolve a pasta das fontes contra a URL do app (HashRouter)", () => {
    expect(fontsBase({ baseURI: "https://localhost/index.html#/viewer" })).toBe(
      "https://localhost/fonts/docx/",
    );
  });

  it("acha só as famílias embutidas citadas nos XMLs", () => {
    const xml = [
      '<w:rFonts w:ascii="Times New Roman"/>',
      '<a:latin typeface="Calibri"/>',
      '<w:rFonts w:ascii="Aptos"/>',
    ];
    expect(familiesIn(xml).sort()).toEqual(["Calibri", "Times New Roman"]);
    expect(familiesIn([])).toEqual([]);
  });
});
