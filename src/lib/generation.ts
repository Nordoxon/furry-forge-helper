import { supabase } from "@/integrations/supabase/client";

/**
 * Управление генерацией с сайта.
 * Агент раз в 30 секунд спрашивает сайт, нужно ли генерировать,
 * и берёт персонажа с включённой генерацией.
 */

/** Пауза: генерация останавливается, отбор и прогресс сохраняются. */
export async function pauseGeneration(characterId: string) {
  const { error } = await supabase
    .from("characters")
    .update({ generation_enabled: false })
    .eq("id", characterId);
  if (error) throw error;
}

/** Запуск/продолжение генерации для персонажа (остальные ставятся на паузу). */
export async function startGeneration(characterId: string) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Нет сессии");

  const { error: offError } = await supabase
    .from("characters")
    .update({ generation_enabled: false })
    .eq("user_id", userId)
    .neq("id", characterId);
  if (offError) throw offError;

  const { error } = await supabase
    .from("characters")
    .update({ generation_enabled: true, prompt_approved: true })
    .eq("id", characterId);
  if (error) throw error;
}
