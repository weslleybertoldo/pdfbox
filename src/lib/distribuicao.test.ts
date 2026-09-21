import { afterEach, describe, expect, it, vi } from "vitest";
import { distribuicao, ehPlay } from "./distribuicao";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("distribuicao (canal do build)", () => {
  it("sem a variável é o APK do site (atualizador in-app ligado)", () => {
    vi.stubEnv("VITE_DISTRIBUICAO", "");
    expect(distribuicao()).toBe("site");
    expect(ehPlay()).toBe(false);
  });

  it("VITE_DISTRIBUICAO=play é a versão da Google Play (sem atualizador)", () => {
    vi.stubEnv("VITE_DISTRIBUICAO", "play");
    expect(distribuicao()).toBe("play");
    expect(ehPlay()).toBe(true);
  });

  it("valor desconhecido cai no site — nunca esconde o atualizador por engano", () => {
    vi.stubEnv("VITE_DISTRIBUICAO", "loja");
    expect(distribuicao()).toBe("site");
    expect(ehPlay()).toBe(false);
  });
});
