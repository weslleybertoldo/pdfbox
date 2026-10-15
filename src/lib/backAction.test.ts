import { describe, expect, it } from "vitest";
import { backAction, EXTERNAL_ENTRY_STATE, isExternalEntry, type BackState } from "./backAction";

const base: BackState = { dialogOpen: false, atHome: false, externalEntry: false, canGoBack: true };

describe("backAction", () => {
  it("popup aberto: o voltar só fecha o popup", () => {
    expect(backAction({ ...base, dialogOpen: true })).toBe("close-dialog");
    expect(backAction({ ...base, dialogOpen: true, atHome: true, externalEntry: true })).toBe("close-dialog");
  });

  it("tela aberta por outro app: pergunta antes de sair, mesmo com histórico", () => {
    expect(backAction({ ...base, externalEntry: true })).toBe("ask-exit");
    expect(backAction({ ...base, externalEntry: true, canGoBack: false })).toBe("ask-exit");
  });

  it("tela inicial: pergunta antes de sair (com ou sem histórico)", () => {
    expect(backAction({ ...base, atHome: true, canGoBack: false })).toBe("ask-exit");
    // o "Voltar" das telas empilha "/" — a tela inicial continua sendo a saída
    expect(backAction({ ...base, atHome: true, canGoBack: true })).toBe("ask-exit");
  });

  it("outras telas: volta uma tela; sem histórico vai pro início", () => {
    expect(backAction(base)).toBe("go-back");
    expect(backAction({ ...base, canGoBack: false })).toBe("go-home");
  });
});

describe("isExternalEntry", () => {
  it("reconhece só a marca de tela aberta por outro app", () => {
    expect(isExternalEntry(EXTERNAL_ENTRY_STATE)).toBe(true);
    expect(isExternalEntry(null)).toBe(false);
    expect(isExternalEntry(undefined)).toBe(false);
    expect(isExternalEntry({ openShareConfig: true })).toBe(false);
    expect(isExternalEntry({ fromOtherApp: "true" })).toBe(false);
  });
});
