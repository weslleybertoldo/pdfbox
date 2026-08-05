import { describe, it, expect } from "vitest";
import { parseDataUrl, fitWidth } from "./htmlToDocx";

// PNG 1x1 transparente (válido) — só pro parse; o docx não valida o conteúdo aqui
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("parseDataUrl", () => {
  it("extrai tipo e bytes de um data: URI png", () => {
    const r = parseDataUrl(`data:image/png;base64,${PNG_1PX}`);
    expect(r).not.toBeNull();
    expect(r!.type).toBe("png");
    // assinatura PNG: 0x89 'P' 'N' 'G'
    expect([...r!.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("normaliza jpeg → jpg", () => {
    const r = parseDataUrl("data:image/jpeg;base64,/9j/4AAQ");
    expect(r?.type).toBe("jpg");
  });

  it("rejeita URLs não-data e mimes não suportados", () => {
    expect(parseDataUrl("https://x.com/a.png")).toBeNull();
    expect(parseDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(parseDataUrl("data:text/html;base64,PGI+")).toBeNull();
  });

  it("rejeita base64 inválido sem lançar", () => {
    expect(parseDataUrl("data:image/png;base64,%%%")).toBeNull();
  });
});

describe("fitWidth", () => {
  it("mantém dimensões quando cabem no máximo", () => {
    expect(fitWidth(300, 200, 600)).toEqual({ width: 300, height: 200 });
  });
  it("reduz proporcionalmente quando excede o máximo", () => {
    expect(fitWidth(1200, 800, 600)).toEqual({ width: 600, height: 400 });
  });
  it("nunca devolve dimensão zero pra entrada degenerada", () => {
    expect(fitWidth(0, 0, 600)).toEqual({ width: 1, height: 1 });
  });
});
