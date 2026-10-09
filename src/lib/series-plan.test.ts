import { expect, test } from "vitest";
import { matchStyle } from "./series-plan";
test("имя персонажа находит стиль CHAR — Имя", () => {
  expect(matchStyle("Blastoise", ["CHAR — Blastoise", "CHAR — Pikachu"])).toBe("CHAR — Blastoise");
  expect(matchStyle("Eevee", [])).toBe("CHAR — Eevee");
});
