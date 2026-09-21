import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SceneChoice = {
  pose_id: string | null;
  pose_text: string;
  background_id: string | null;
  background_text: string;
};

export const EMPTY_SCENE: SceneChoice = {
  pose_id: null,
  pose_text: "",
  background_id: null,
  background_text: "",
};

type Item = { code: string; prompt: string };

function pick(all: Item[], used: Set<string>): Item | null {
  if (all.length === 0) return null;
  // сначала берём то, что в текущем паке ещё не использовалось
  const fresh = all.filter((i) => !used.has(i.code));
  const pool = fresh.length > 0 ? fresh : all;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/**
 * Выбор позы и фона для нового задания.
 * Внутри текущего пака (кадры персонажа без pack_id) поза и фон
 * не повторяются, пока остаются неиспользованные варианты.
 */
export async function pickScene(
  supabase: SupabaseClient<Database>,
  userId: string,
  characterId: string,
): Promise<SceneChoice> {
  const [posesRes, bgRes, usedRes] = await Promise.all([
    supabase.from("poses").select("code, prompt").eq("user_id", userId).eq("enabled", true),
    supabase.from("backgrounds").select("code, prompt").eq("user_id", userId).eq("enabled", true),
    supabase
      .from("images")
      .select("pose_id, background_id")
      .eq("user_id", userId)
      .eq("character_id", characterId)
      .is("pack_id", null),
  ]);

  const usedPoses = new Set<string>();
  const usedBackgrounds = new Set<string>();
  for (const row of usedRes.data ?? []) {
    if (row.pose_id) usedPoses.add(row.pose_id);
    if (row.background_id) usedBackgrounds.add(row.background_id);
  }

  const pose = pick((posesRes.data ?? []) as Item[], usedPoses);
  const background = pick((bgRes.data ?? []) as Item[], usedBackgrounds);

  return {
    pose_id: pose?.code ?? null,
    pose_text: pose?.prompt ?? "",
    background_id: background?.code ?? null,
    background_text: background?.prompt ?? "",
  };
}

/** Поза и фон дописываются к текущему промпту, структура промпта не меняется. */
export function applyScene(prompt: string, scene: SceneChoice): string {
  const parts = [prompt.trim().replace(/,\s*$/, ""), scene.pose_text.trim(), scene.background_text.trim()];
  return parts.filter(Boolean).join(", ");
}
