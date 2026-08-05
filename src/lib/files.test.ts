import { describe, it, expect } from "vitest";
import { formatBytes } from "./files";

describe("formatBytes", () => {
  it("formata bytes, KB e MB", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3.5 * 1024 ** 2)).toBe("3.5 MB");
  });
});
