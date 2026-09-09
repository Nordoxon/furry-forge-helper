import { supabase } from "@/integrations/supabase/client";

export type PromptDefaults = {
  sfw_prompt: string;
  nsfw_prompt: string;
  negative_prompt: string;
};

export type SpeciesTagRow = {
  id: string;
  species: string;
  tags: string[];
};

export const EMPTY_DEFAULTS: PromptDefaults = {
  sfw_prompt: "",
  nsfw_prompt: "",
  negative_prompt: "",
};

/** Промпты по умолчанию — подставляются в нового персонажа. */
export async function fetchPromptDefaults(): Promise<PromptDefaults> {
  const { data, error } = await supabase
    .from("prompt_defaults")
    .select("sfw_prompt, nsfw_prompt, negative_prompt")
    .maybeSingle();
  if (error) throw error;
  return data ?? EMPTY_DEFAULTS;
}

export async function savePromptDefaults(values: PromptDefaults) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Нет сессии");
  const { error } = await supabase
    .from("prompt_defaults")
    .upsert({ user_id: userId, ...values }, { onConflict: "user_id" });
  if (error) throw error;
}

/** Наборы тегов по виду: pokemon, digimon и т.д. */
export async function fetchSpeciesTags(): Promise<SpeciesTagRow[]> {
  const { data, error } = await supabase
    .from("species_tags")
    .select("id, species, tags")
    .order("species", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function saveSpeciesTags(species: string, tags: string[]) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Нет сессии");
  const { error } = await supabase
    .from("species_tags")
    .upsert(
      { user_id: userId, species: species.trim().toLowerCase(), tags },
      { onConflict: "user_id,species" },
    );
  if (error) throw error;
}

export async function deleteSpeciesTags(id: string) {
  const { error } = await supabase.from("species_tags").delete().eq("id", id);
  if (error) throw error;
}

/** Теги для введённого вида: «pokemon, digimon» → объединение наборов. */
export function tagsForSpecies(species: string, rows: SpeciesTagRow[]): string[] {
  const wanted = species
    .split(/[,/]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: string[] = [];
  for (const w of wanted) {
    const row = rows.find((r) => r.species.toLowerCase() === w);
    for (const t of row?.tags ?? []) if (!out.includes(t)) out.push(t);
  }
  return out;
}
