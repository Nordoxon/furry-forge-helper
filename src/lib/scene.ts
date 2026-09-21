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

/** Плейсхолдеры в шаблонах промпта, которые заменяются текстом из библиотеки сцен. */
export const POSE_PLACEHOLDERS = ["__new_poses__", "__deepposes__"] as const;
export const BACKGROUND_PLACEHOLDERS = ["__new_backgrounds__"] as const;

function replaceAll(prompt: string, tokens: readonly string[], text: string) {
  let out = prompt;
  let found = false;
  for (const token of tokens) {
    if (!out.includes(token)) continue;
    found = true;
    out = out.split(token).join(text);
  }
  return { out, found };
}

/**
 * Поза и фон ЗАМЕНЯЮТ соответствующие плейсхолдеры в шаблоне промпта.
 * Ничего не дописывается в конец: если плейсхолдера нет, возвращается
 * предупреждение, а остальная часть промпта остаётся без изменений.
 */
export function applyScene(
  prompt: string,
  scene: SceneChoice,
): { prompt: string; warnings: string[] } {
  const warnings: string[] = [];
  let out = prompt;

  if (scene.pose_text.trim()) {
    const res = replaceAll(out, POSE_PLACEHOLDERS, scene.pose_text.trim());
    out = res.out;
    if (!res.found)
      warnings.push(
        `в шаблоне промпта нет плейсхолдера позы (${POSE_PLACEHOLDERS.join(" или ")}) — поза ${scene.pose_id ?? ""} не подставлена`,
      );
  }

  if (scene.background_text.trim()) {
    const res = replaceAll(out, BACKGROUND_PLACEHOLDERS, scene.background_text.trim());
    out = res.out;
    if (!res.found)
      warnings.push(
        `в шаблоне промпта нет плейсхолдера фона (${BACKGROUND_PLACEHOLDERS.join(" или ")}) — фон ${scene.background_id ?? ""} не подставлен`,
      );
  }

  return { prompt: out, warnings };
}

