/** Единое место рендера описания эксклюзива. Своё описание персонажа важнее шаблона. */
export function renderDescription(
  own: string | null | undefined,
  template: string | null | undefined,
  vars: { number: number | null | undefined; character: string; scene: string },
) {
  if (own && own.trim()) return own;
  return (template ?? "")
    .replaceAll("{number}", vars.number == null ? "" : String(vars.number))
    .replaceAll("{character}", vars.character)
    .replaceAll("{scene}", vars.scene);
}

export type CensorRect = { x1: number; y1: number; x2: number; y2: number };

/** Перевод прямоугольников из пикселей кадра в проценты (для шаблона автоцензуры). */
export function rectsToPreset(rects: { x: number; y: number; w: number; h: number }[], width: number, height: number): CensorRect[] {
  const p = (v: number, d: number) => Math.round((v / d) * 10000) / 100;
  return rects.map((r) => ({ x1: p(r.x, width), y1: p(r.y, height), x2: p(r.x + r.w, width), y2: p(r.y + r.h, height) }));
}
