import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type TemplateRow = Database["public"]["Tables"]["publish_templates"]["Row"];

export const MATURE_CLASSES = [
  { value: "nudity", label: "Обнажённость" },
  { value: "sexual", label: "Сексуальные темы" },
  { value: "gore", label: "Кровь / насилие" },
  { value: "language", label: "Ненормативная лексика" },
  { value: "ideology", label: "Идеология" },
] as const;

export const RESOLUTIONS = [
  { value: 0, label: "Оригинал" },
  { value: 400, label: "400 px" },
  { value: 600, label: "600 px" },
  { value: 800, label: "800 px" },
  { value: 1024, label: "1024 px" },
] as const;

export async function fetchTemplates() {
  const { data, error } = await supabase
    .from("publish_templates")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function deleteTemplate(id: string) {
  const { error } = await supabase.from("publish_templates").delete().eq("id", id);
  if (error) throw error;
}
