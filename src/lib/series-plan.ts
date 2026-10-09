import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

/** Подстановка {character}/{scene}/{background}/{composition} в шаблон серии. */
export function renderSeriesPrompt(
  template: string,
  vars: { character: string; scene: string; background: string; composition: string },
) {
  const base = template.trim() || "{character}, {background}, {composition}";
  return base
    .replaceAll("{character}", vars.character)
    .replaceAll("{scene}", vars.scene)
    .replaceAll("{background}", vars.background)
    .replaceAll("{composition}", vars.composition)
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .trim();
}

export async function userMode(supabase: DB, userId: string) {
  const { data } = await supabase
    .from("user_settings")
    .select("mode")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.mode === "series" ? "series" : "pack";
}

/**
 * План для режима «Отдельные изображения»: идём по очереди персонажей
 * запущенной серии и генерируем каждому N вариантов.
 */
export async function seriesPlan(supabase: DB, userId: string) {
  const { data: series } = await supabase
    .from("series")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!series) return { job: null, reason: "Нет запущенной серии" } as const;

  const { data: items } = await supabase
    .from("series_items")
    .select("*")
    .eq("series_id", series.id)
    .in("status", ["waiting", "generating"])
    .order("position", { ascending: true });

  for (const item of items ?? []) {
    const target = series.variants + item.requested_variants;
    const { count } = await supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("series_item_id", item.id);
    const { count: active } = await supabase
      .from("generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("series_item_id", item.id)
      .in("status", ["QUEUED", "CLAIMED", "GENERATING", "UPLOADING"]);
    const done = (count ?? 0) + (active ?? 0);
    if (done >= target) {
      if ((active ?? 0) === 0) {
        await supabase.from("series_items").update({ status: "choosing" }).eq("id", item.id);
      }
      continue;
    }
    if (item.status !== "generating") {
      await supabase.from("series_items").update({ status: "generating" }).eq("id", item.id);
    }
    const style = await resolveStyle(supabase, item.name, item.character_id);
    const settings = {
      ...((series.settings as Record<string, unknown>) ?? {}),
      style,
    };
    const prompt = renderSeriesPrompt(series.prompt, {
      character: item.name,
      scene: series.scene_name,
      background: series.scene_background,
      composition: series.scene_composition,
    });
    return {
      job: {
        series,
        item,
        prompt,
        negative_prompt: series.negative_prompt,
        settings,
        variant: done + 1,
        target,
      },
      reason: null,
    } as const;
  }
  return { job: null, reason: "Все персонажи серии сгенерированы" } as const;
}

/** Имя в серии — «Blastoise», а в styles.csv стиль называется «CHAR — Blastoise». */
export async function resolveStyle(supabase: DB, name: string, characterId: string | null) {
  if (characterId) {
    const { data } = await supabase.from("characters").select("gen_style").eq("id", characterId).maybeSingle();
    if (data?.gen_style) return data.gen_style;
  }
  const { data: styles } = await supabase.from("gen_styles").select("name");
  return matchStyle(name, (styles ?? []).map((s) => s.name));
}

export function matchStyle(name: string, styles: string[]) {
  const n = name.trim().toLowerCase();
  const strip = (s: string) => s.replace(/^\s*char\s*[—–-]\s*/i, "").trim().toLowerCase();
  return (
    styles.find((s) => s.toLowerCase() === n) ??
    styles.find((s) => strip(s) === n) ??
    `CHAR — ${name.trim()}`
  );
}
