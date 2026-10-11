import { describe, expect, it } from "vitest";
import { rectsToPreset, renderDescription } from "./series-description";

describe("renderDescription", () => {
  it("own description wins over template", () => {
    expect(renderDescription("Мой текст", "#{number}", { number: 4, character: "Fox", scene: "Beach" })).toBe("Мой текст");
  });
  it("renders number, character and scene", () => {
    expect(renderDescription("", "#{number} {character} at {scene}", { number: 4, character: "Fox", scene: "Beach" })).toBe(
      "#4 Fox at Beach",
    );
  });
  it("empty when nothing set", () => {
    expect(renderDescription("", "", { number: 1, character: "a", scene: "b" })).toBe("");
  });
});

describe("rectsToPreset", () => {
  it("converts pixels to percent of frame", () => {
    expect(rectsToPreset([{ x: 83.2, y: 121.6, w: 416, h: 608 }], 832, 1216)).toEqual([{ x1: 10, y1: 10, x2: 60, y2: 60 }]);
  });
});
