import { describe, expect, it } from "vitest";
import { compatMode } from "./justify";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const settings = (compat: string) => `<?xml version="1.0"?><w:settings ${W}><w:compat>${compat}</w:compat></w:settings>`;

describe("compatMode", () => {
  it("lê o compatibilityMode em qualquer ordem de atributo (ofício da FABd = 15)", () => {
    expect(compatMode(settings('<w:compatSetting w:val="15" w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word"/>'))).toBe(15);
    expect(compatMode(settings('<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/>'))).toBe(14);
  });

  it("ignora os outros compatSetting e devolve 0 quando o arquivo não diz", () => {
    expect(compatMode(settings('<w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:val="1"/>'))).toBe(0);
    expect(compatMode("")).toBe(0);
  });
});
