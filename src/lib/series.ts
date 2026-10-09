import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Series = Database["public"]["Tables"]["series"]["Row"];
export type SeriesItem = Database["public"]["Tables"]["series_items"]["Row"];
export type UserSettings = Database["public"]["Tables"]["user_settings"]["Row"];

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Нужно войти");
  return data.user.id;
}

export async function fetchSettings(): Promise<UserSettings> {
  const user_id = await uid();
  const { data } = await supabase.from("user_settings").select("*").eq("user_id", user_id).maybeSingle();
  if (data) return data;
  const { data: created, error } = await supabase
    .from("user_settings")
    .insert({ user_id })
    .select("*")
    .single();
  if (error) throw error;
  return created;
}

export async function saveSettings(patch: Partial<UserSettings>) {
  const user_id = await uid();
  const { error } = await supabase.from("user_settings").upsert({ user_id, ...patch });
  if (error) throw error;
}

export async function fetchSeriesList() {
  const { data, error } = await supabase
    .from("series")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data;
}

export async function fetchItems(seriesId: string) {
  const { data, error } = await supabase
    .from("series_items")
    .select("*")
    .eq("series_id", seriesId)
    .order("position");
  if (error) throw error;
  return data;
}

export async function fetchVariants(seriesId: string) {
  const { data: items } = await supabase.from("series_items").select("id").eq("series_id", seriesId);
  const ids = (items ?? []).map((i) => i.id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("images")
    .select("id, series_item_id, preview_path, status, created_at")
    .in("series_item_id", ids)
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function createSeries(input: Partial<Series>, names: string[]) {
  const user_id = await uid();
  const { data: s, error } = await supabase
    .from("series")
    .insert({ ...input, user_id })
    .select("*")
    .single();
  if (error) throw error;
  await addItems(s.id, names, 0);
  return s;
}

export async function addItems(seriesId: string, names: string[], start: number) {
  const user_id = await uid();
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) return;
  const { data: chars } = await supabase.from("characters").select("id, name, gen_style");
  const byName = new Map(
    (chars ?? []).flatMap((c) => [
      [c.name.toLowerCase(), c.id],
      [(c.gen_style || "").toLowerCase(), c.id],
    ]),
  );
  const { error } = await supabase.from("series_items").insert(
    clean.map((name, i) => ({
      user_id,
      series_id: seriesId,
      name,
      character_id: byName.get(name.toLowerCase()) ?? null,
      position: start + i,
    })),
  );
  if (error) throw error;
}

export async function updateSeries(id: string, patch: Partial<Series>) {
  const { error } = await supabase.from("series").update(patch).eq("id", id);
  if (error) throw error;
}

export async function updateItem(id: string, patch: Partial<SeriesItem>) {
  const { error } = await supabase.from("series_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from("series_items").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteSeries(id: string) {
  await supabase
    .from("generation_jobs")
    .update({ status: "CANCELLED" })
    .in("status", ["QUEUED"])
    .in("series_item_id", (await supabase.from("series_items").select("id").eq("series_id", id)).data?.map((i) => i.id) ?? []);
  const r1 = await supabase.from("series_items").delete().eq("series_id", id);
  if (r1.error) throw r1.error;
  const r2 = await supabase.from("series").delete().eq("id", id);
  if (r2.error) throw r2.error;
}

export function renderTitle(tpl: string, n: number, character: string) {
  return tpl.replaceAll("{number}", String(n)).replaceAll("{character}", character);
}

/** Выбор лучшего варианта: присваиваем глобальный номер, название и теги. */
export async function chooseVariant(item: SeriesItem, series: Series, imageId: string) {
  const settings = await fetchSettings();
  const n = item.exclusive_number ?? settings.next_exclusive_number;
  let charTags: string[] = [];
  if (item.character_id) {
    const { data } = await supabase.from("characters").select("base_tags").eq("id", item.character_id).maybeSingle();
    charTags = data?.base_tags ?? [];
  }
  const tags = Array.from(new Set([...settings.default_tags, ...charTags])).slice(0, 30);
  await updateItem(item.id, {
    selected_image_id: imageId,
    exclusive_number: n,
    title: renderTitle(settings.title_template, n, item.name),
    tags,
    status: series.auto_upscale ? "selected" : "chosen",
  });
  if (item.exclusive_number == null) await saveSettings({ next_exclusive_number: n + 1 });
  await supabase.from("images").update({ status: "approved", reviewed_at: new Date().toISOString(), decision_source: "human" }).eq("id", imageId);
  await supabase
    .from("images")
    .update({ status: "rejected", reviewed_at: new Date().toISOString(), decision_source: "human" })
    .eq("series_item_id", item.id)
    .neq("id", imageId);
}

/** Отмена выбора: варианты снова ждут решения, номер персонажа сохраняется. */
export async function unchooseVariant(item: SeriesItem) {
  await updateItem(item.id, { selected_image_id: null, status: "choosing", error: null });
  await supabase
    .from("images")
    .update({ status: "new", reviewed_at: null, decision_source: null })
    .eq("series_item_id", item.id);
}

export async function uploadCensored(item: SeriesItem, blob: Blob) {
  const user_id = await uid();
  const path = `${user_id}/series/${item.id}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("previews").upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  if (item.censored_preview_path) await supabase.storage.from("previews").remove([item.censored_preview_path]);
  await updateItem(item.id, { censored_preview_path: path });
  return path;
}

export async function signed(path: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("previews").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export const ITEM_STATUS: Record<string, string> = {
  waiting: "в очереди",
  generating: "генерация",
  choosing: "выбор варианта",
  chosen: "выбран, ждёт апскейла",
  selected: "ждёт апскейла",
  upscaling: "апскейл",
  upscaled: "цензура превью",
  preview_ready: "ждёт загрузки на DA",
  publishing: "загрузка на DA",
  published: "на DeviantArt",
  error: "ошибка",
};
