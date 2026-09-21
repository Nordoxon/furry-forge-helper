import { supabase } from "@/integrations/supabase/client";

export type GenStyle = { id: string; name: string };

/** Сохранённые на сайте имена стилей (шаблонов персонажей) из styles.csv. */
export async function fetchGenStyles(): Promise<GenStyle[]> {
  const { data, error } = await supabase
    .from("gen_styles")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addGenStyle(name: string) {
  const clean = name.trim();
  if (!clean) return;
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("gen_styles")
    .upsert({ user_id: userData.user!.id, name: clean }, { onConflict: "user_id,name" });
  if (error) throw error;
}

export async function deleteGenStyle(name: string) {
  const { error } = await supabase.from("gen_styles").delete().eq("name", name);
  if (error) throw error;
}

/** Последний выбранный персонаж — чтобы страница открывалась на нём. */
const LAST_CHARACTER_KEY = "ffh:last-character";

export function rememberCharacter(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(LAST_CHARACTER_KEY, id);
  else window.localStorage.removeItem(LAST_CHARACTER_KEY);
}

export function recallCharacter(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_CHARACTER_KEY);
}
