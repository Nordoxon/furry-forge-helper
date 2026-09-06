import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { ImageRow } from "@/lib/images";

export type PackRow = Database["public"]["Tables"]["packs"]["Row"];

/** Отобранные изображения, ещё не вошедшие ни в один пак. */
export async function fetchSelection(): Promise<ImageRow[]> {
  const { data, error } = await supabase
    .from("images")
    .select("*")
    .is("pack_id", null)
    .in("status", ["approved", "upscaling", "uploading", "ready", "published"])
    .order("created_at", { ascending: true });
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

/** Собирает пак из всех отобранных изображений без пака. */
export async function buildPack(title: string, items: ImageRow[]): Promise<PackRow> {
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
  return pack;
}

export function packLabel(pack: { sfw_count: number; nsfw_count: number }) {
  return `${pack.sfw_count} SFW + ${pack.nsfw_count} NSFW images`;
}
