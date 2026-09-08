import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { ImageRow } from "@/lib/images";

export type PackRow = Database["public"]["Tables"]["packs"]["Row"];

/** Отобранные изображения, ещё не вошедшие ни в один пак. */
export async function fetchSelection(characterId?: string | null): Promise<ImageRow[]> {
  let query = supabase
    .from("images")
    .select("*")
    .is("pack_id", null)
    .in("status", ["approved", "upscaling", "uploading", "ready", "published"])
    .order("created_at", { ascending: true });
  if (characterId) query = query.eq("character_id", characterId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchPacks(): Promise<PackRow[]> {
  const { data, error } = await supabase
    .from("packs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function fetchPackImages(packId: string): Promise<ImageRow[]> {
  const { data, error } = await supabase
    .from("images")
    .select("*")
    .eq("pack_id", packId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function setKind(id: string, kind: "sfw" | "nsfw") {
  const { error } = await supabase.from("images").update({ content_kind: kind }).eq("id", id);
  if (error) throw error;
}

export async function setPreviewFlag(id: string, isPreview: boolean) {
  const { error } = await supabase.from("images").update({ is_preview: isPreview }).eq("id", id);
  if (error) throw error;
}

/** Обложка — ровно одно изображение в текущем отборе. */
export async function setCoverFlag(id: string, characterId: string | null, isCover: boolean) {
  if (isCover) {
    let q = supabase.from("images").update({ is_cover: false }).is("pack_id", null);
    if (characterId) q = q.eq("character_id", characterId);
    const { error: clearError } = await q;
    if (clearError) throw clearError;
  }
  const { error } = await supabase.from("images").update({ is_cover: isCover }).eq("id", id);
  if (error) throw error;
}

/** Ссылка на скачивание архива пака (действует час). */
export async function packZipUrl(zipPath: string): Promise<string | null> {
  const { data } = await supabase.storage.from("packs").createSignedUrl(zipPath, 3600);
  return data?.signedUrl ?? null;
}

/** Удаляет архив пака из облака, чтобы не занимать место. */
export async function deletePackZip(packId: string, zipPath: string) {
  const { error } = await supabase.storage.from("packs").remove([zipPath]);
  if (error) throw error;
  const { error: dbError } = await supabase
    .from("packs")
    .update({ zip_path: null, status: "done" })
    .eq("id", packId);
  if (dbError) throw dbError;
}


/** Собирает пак из всех отобранных изображений без пака. */
export async function buildPack(
  title: string,
  items: ImageRow[],
  characterId: string | null = null,
  packNumber: number | null = null,
): Promise<PackRow> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Нет сессии");

  const sfw = items.filter((i) => i.content_kind === "sfw").length;
  const nsfw = items.length - sfw;

  const { data: pack, error } = await supabase
    .from("packs")
    .insert({
      user_id: userId,
      title: title || new Date().toLocaleDateString("ru-RU"),
      character_id: characterId,
      pack_number: packNumber,
      sfw_count: sfw,
      nsfw_count: nsfw,
      status: "building",
    })
    .select()
    .single();
  if (error) throw error;

  const { error: linkError } = await supabase
    .from("images")
    .update({ pack_id: pack.id })
    .in(
      "id",
      items.map((i) => i.id),
    );
  if (linkError) throw linkError;

  // сборка пака останавливает генерацию на компьютере
  if (characterId) {
    await supabase
      .from("characters")
      .update({ generation_enabled: false })
      .eq("id", characterId);
  }
  return pack;
}

export function packLabel(pack: { sfw_count: number; nsfw_count: number }) {
  return `${pack.sfw_count} SFW + ${pack.nsfw_count} NSFW images`;
}

/** Удаляет изображения с сайта (записи в базе; файлы на компьютере остаются). */
export async function deleteImages(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from("images").delete().in("id", ids);
  if (error) throw error;
}

/** Очищает всё, что сейчас ждёт отбора. */
export async function clearInbox(): Promise<number> {
  const { data, error } = await supabase.from("images").delete().eq("status", "new").select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/** Следующий номер пака для персонажа. */
export async function nextPackNumber(characterId: string | null): Promise<number> {
  let q = supabase.from("packs").select("pack_number").order("pack_number", { ascending: false }).limit(1);
  q = characterId ? q.eq("character_id", characterId) : q.is("character_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data?.[0]?.pack_number ?? 0) + 1;
}
