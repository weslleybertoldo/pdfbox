import { describe, it, expect } from "vitest";
import { isNewerVersion } from "./version";

describe("isNewerVersion", () => {
  it("detecta major/minor/patch maior", () => {
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("1.1.2", "1.1.1")).toBe(true);
  });
  it("false para igual ou menor", () => {
    expect(isNewerVersion("1.1.1", "1.1.1")).toBe(false);
    expect(isNewerVersion("1.0.9", "1.1.0")).toBe(false);
  });
  it("tolera prefixo v e campos ausentes", () => {
    expect(isNewerVersion("v1.2", "1.1.5")).toBe(true);
    expect(isNewerVersion("", "1.0.0")).toBe(false);
  });
});
