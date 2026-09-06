import { supabase } from "@/integrations/supabase/client";
import type { CharacterRow, ImageRow } from "@/lib/images";

export type BatchPhase = "sfw" | "nsfw" | "preview" | "ready";

export type BatchState = {
  sfw: ImageRow[];
  nsfw: ImageRow[];
  previews: ImageRow[];
  sfwTarget: number;
  nsfwTarget: number;
  previewTarget: number;
  phase: BatchPhase;
  /** Тип, который сейчас нужно присваивать новым кадрам. */
  activeKind: "sfw" | "nsfw";
  total: number;
  targetTotal: number;
  done: boolean;
};

export function batchState(character: CharacterRow | null, items: ImageRow[]): BatchState {
  const sfwTarget = character?.sfw_target ?? 8;
  const nsfwTarget = character?.nsfw_target ?? 23;
  const previewTarget = character?.preview_target ?? 4;

  const sfw = items.filter((i) => i.content_kind === "sfw");
  const nsfw = items.filter((i) => i.content_kind !== "sfw");
  const previews = sfw.filter((i) => i.is_preview);

  let phase: BatchPhase = "sfw";
  if (sfw.length < sfwTarget) phase = "sfw";
  else if (nsfw.length < nsfwTarget) phase = "nsfw";
  else if (previews.length < Math.min(3, previewTarget)) phase = "preview";
  else phase = "ready";

  return {
    sfw,
    nsfw,
    previews,
    sfwTarget,
    nsfwTarget,
    previewTarget,
    phase,
    activeKind: phase === "sfw" ? "sfw" : "nsfw",
    total: items.length,
    targetTotal: sfwTarget + nsfwTarget,
    done: phase === "preview" || phase === "ready",
  };
}

/** Сбрасывает текущую незакрытую партию персонажа (собранные паки не трогает). */
export async function resetBatch(characterId: string): Promise<number> {
  const { data, error } = await supabase
    .from("images")
    .delete()
    .eq("character_id", characterId)
    .is("pack_id", null)
    .neq("status", "new")
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function updateTargets(
  characterId: string,
  targets: { sfw_target?: number; nsfw_target?: number; preview_target?: number },
) {
  const { error } = await supabase.from("characters").update(targets).eq("id", characterId);
  if (error) throw error;
}
