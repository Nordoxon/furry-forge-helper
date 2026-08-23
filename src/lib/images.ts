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

export async function decide(
  id: string,
  status: ImageStatus,
  characterId: string | null,
  galleryFolder?: string | null,
) {
  const { error } = await supabase
    .from("images")
    .update({ status, character_id: characterId, gallery_folder: galleryFolder ?? null })
    .eq("id", id);
  if (error) throw error;
}
