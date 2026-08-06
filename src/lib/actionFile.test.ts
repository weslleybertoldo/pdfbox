import { describe, it, expect } from "vitest";
import { setActionFile, consumeActionFile, actionFileToFile } from "./actionFile";

describe("actionFile (handoff viewer → telas de função)", () => {
  it("entrega o arquivo setado e limpa (consumo único)", () => {
    const f = { blob: new Blob(["%PDF"]), name: "doc.pdf", mimeType: "application/pdf" };
    setActionFile(f);
    expect(consumeActionFile()).toEqual(f);
    expect(consumeActionFile()).toBeNull(); // não re-entrega
  });

  it("sem arquivo pendente devolve null", () => {
    expect(consumeActionFile()).toBeNull();
  });

  it("setar de novo substitui o pendente anterior", () => {
    setActionFile({ blob: new Blob(["a"]), name: "a.pdf", mimeType: "application/pdf" });
    setActionFile({ blob: new Blob(["b"]), name: "b.png", mimeType: "image/png" });
    expect(consumeActionFile()?.name).toBe("b.png");
  });

  it("actionFileToFile preserva nome, tipo e conteúdo", async () => {
    const file = actionFileToFile({
      blob: new Blob(["conteudo"]), name: "x.pdf", mimeType: "application/pdf",
    });
    expect(file.name).toBe("x.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toBe("conteudo");
  });
});
