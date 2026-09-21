import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ImageRow = Database["public"]["Tables"]["images"]["Row"];
export type CharacterRow = Database["public"]["Tables"]["characters"]["Row"];
export type ImageStatus = Database["public"]["Enums"]["image_status"];

export const STATUS_LABELS: Record<ImageStatus, string> = {
  new: "Новое",
  approved: "Одобрено",
  rejected: "Отклонено",
  upscaling: "Апскейл",
  uploading: "Загрузка",
  ready: "Готово (в архив)",
  published: "На DeviantArt",
  error: "Ошибка",
};


export async function signedPreview(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("previews").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function fetchInbox() {
  const { data, error } = await supabase
    .from("images")
    .select("*")
    .eq("status", "new")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data;
}

export async function fetchCharacters() {
  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchPipeline() {
  const { data, error } = await supabase
    .from("images")
    .select("*")
    .neq("status", "new")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

export const REJECT_REASONS = [
  { value: "anatomy", label: "Анатомия" },
  { value: "face", label: "Лицо" },
  { value: "pose", label: "Поза" },
  { value: "background", label: "Фон" },
  { value: "composition", label: "Композиция" },
  { value: "cropping", label: "Кадрирование" },
  { value: "duplicate", label: "Дубликат" },
  { value: "character", label: "Персонаж" },
  { value: "other", label: "Другое" },
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number]["value"];

/** Больше этого количества неразобранных кадров агент не генерирует. */
export const PENDING_LIMIT = 6;

export async function decide(
  id: string,
  status: ImageStatus,
  characterId: string | null,
  extra?: {
    contentKind?: "sfw" | "nsfw";
    isPreview?: boolean;
    rejectReasons?: RejectReason[];
    rejectNote?: string | null;
  },
) {
  const reasons = extra?.rejectReasons ?? [];
  const review =
    status === "new"
      ? {
          reviewed_at: null,
          reject_reason: null,
          reject_reasons: null,
          reject_note: null,
          decision_source: null,
        }
      : status === "approved"
        ? {
            reviewed_at: new Date().toISOString(),
            reject_reason: null,
            reject_reasons: null,
            reject_note: null,
            decision_source: "human",
          }
        : status === "rejected"
          ? {
              reviewed_at: new Date().toISOString(),
              reject_reason: reasons[0] ?? null,
              reject_reasons: reasons.length > 0 ? reasons : null,
              reject_note: extra?.rejectNote?.trim() ? extra.rejectNote.trim().slice(0, 200) : null,
              decision_source: "human",
            }
          : {};

  const { error } = await supabase
    .from("images")
    .update({
      status,
      character_id: characterId,
      ...review,
      ...(extra?.contentKind ? { content_kind: extra.contentKind } : {}),
      ...(extra?.isPreview !== undefined ? { is_preview: extra.isPreview } : {}),
    })
    .eq("id", id);
  if (error) throw error;
}


