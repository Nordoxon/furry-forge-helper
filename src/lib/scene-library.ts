import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PoseRow = Database["public"]["Tables"]["poses"]["Row"];
export type BackgroundRow = Database["public"]["Tables"]["backgrounds"]["Row"];
export type SceneKind = "poses" | "backgrounds";

export async function fetchScenes(kind: SceneKind) {
  const { data, error } = await supabase.from(kind).select("*").order("code", { ascending: true });
  if (error) throw error;
  return data as (PoseRow | BackgroundRow)[];
}

export async function setSceneEnabled(kind: SceneKind, id: string, enabled: boolean) {
  const { error } = await supabase.from(kind).update({ enabled }).eq("id", id);
  if (error) throw error;
}

/** Сколько раз поза/фон уже встречались в кадрах. */
export async function fetchSceneUsage(kind: SceneKind) {
  const column = kind === "poses" ? "pose_id" : "background_id";
  const { data, error } = await supabase.from("images").select(`${column}, status`);
  if (error) throw error;
  const stats = new Map<string, { total: number; approved: number; rejected: number }>();
  for (const row of (data ?? []) as Record<string, string | null>[]) {
    const code = row[column];
    if (!code) continue;
    const s = stats.get(code) ?? { total: 0, approved: 0, rejected: 0 };
    s.total += 1;
    if (row["status"] === "rejected") s.rejected += 1;
    else if (row["status"] !== "new") s.approved += 1;
    stats.set(code, s);
  }
  return stats;
}
