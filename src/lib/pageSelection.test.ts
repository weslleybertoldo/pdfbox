import { describe, it, expect } from "vitest";
import { splitSelection } from "./pageSelection";

describe("splitSelection", () => {
  it("separa selecionadas e restantes preservando ordem", () => {
    expect(splitSelection(10, [5])).toEqual({
      selected: [5],
      rest: [1, 2, 3, 4, 6, 7, 8, 9, 10],
    });
  });
  it("ignora fora do range e duplicadas, ordena", () => {
    expect(splitSelection(3, [3, 3, 0, 4, 1])).toEqual({
      selected: [1, 3],
      rest: [2],
    });
  });
});
