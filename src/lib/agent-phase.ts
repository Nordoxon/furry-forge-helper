import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Character = Database["public"]["Tables"]["characters"]["Row"];

export type GenPlan = {
  generate: boolean;
  phase: "sfw" | "nsfw" | "done" | "idle";
  prompt: string;
  negative_prompt: string;
  character: Character | null;
  sfw: number;
  nsfw: number;
  reason: string;
};

/**
 * Единственный источник правды по этапу отбора: сервер решает,
 * какой персонаж активен, какая категория генерируется и нужен ли ещё кадр.
 * Агент никогда не угадывает переход SFW → NSFW сам.
 */
export async function genPlan(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<GenPlan> {
  const { data: chars } = await supabase
    .from("characters")
    .select("*")
    .eq("user_id", userId)
    .eq("generation_enabled", true)
    .eq("prompt_approved", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  const character = (chars ?? [])[0] ?? null;
  if (!character) {
    return {
      generate: false,
      phase: "idle",
      prompt: "",
      negative_prompt: "",
      character: null,
      sfw: 0,
      nsfw: 0,
      reason: "Нет персонажа с подтверждённым промптом",
    };
  }

  const { data: picked } = await supabase
    .from("images")
    .select("content_kind")
    .eq("user_id", userId)
    .eq("character_id", character.id)
    .is("pack_id", null)
    .in("status", ["approved", "upscaling", "uploading", "ready", "published"]);

  const list = picked ?? [];
  const sfw = list.filter((i) => i.content_kind === "sfw").length;
  const nsfw = list.length - sfw;

  let phase: "sfw" | "nsfw" | "done" = "sfw";
  if (sfw >= character.sfw_target) phase = nsfw >= character.nsfw_target ? "done" : "nsfw";

  // пока в очереди лежит лимит неразобранных кадров, новые задания не выдаём
  const { count: pendingCount } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "new");
  const pending = pendingCount ?? 0;
  if (phase !== "done" && pending >= PENDING_LIMIT) {
    return {
      generate: false,
      phase,
      prompt: "",
      negative_prompt: character.negative_prompt,
      character,
      sfw,
      nsfw,
      reason: `Достигнут лимит ${PENDING_LIMIT} необработанных изображений — отберите кадры`,
    };
  }


  const prompt = phase === "sfw" ? character.sfw_prompt : phase === "nsfw" ? character.nsfw_prompt : "";

  return {
    generate: phase !== "done" && Boolean(prompt.trim()),
    phase,
    prompt,
    negative_prompt: character.negative_prompt,
    character,
    sfw,
    nsfw,
    reason:
      phase === "done"
        ? "Отбор закрыт — генерация остановлена"
        : prompt.trim()
          ? ""
          : `Пустой промпт для этапа ${phase}`,
  };
}

export function genSettings(character: Character) {
  return {
    width: character.gen_width,
    height: character.gen_height,
    cfg_scale: Number(character.gen_cfg),
    steps: character.gen_steps,
    sampler_name: character.gen_sampler,
    batch_count: character.gen_batch_count,
    style: character.gen_style,
  };
}
