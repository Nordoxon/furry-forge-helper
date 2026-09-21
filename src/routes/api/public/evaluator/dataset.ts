import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * Только чтение: датасет уже просмотренных человеком кадров для ИИ-оценщика.
 * Никаких записей в базу этот маршрут не делает.
 */
export const Route = createFileRoute("/api/public/evaluator/dataset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        const url = new URL(request.url);
        const character = url.searchParams.get("character");
        const status = url.searchParams.get("status");
        const from = url.searchParams.get("reviewed_from");
        const to = url.searchParams.get("reviewed_to");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000) || 1000, 5000);

        const { data: chars } = await supabase
          .from("characters")
          .select("id, name")
          .eq("user_id", userId);
        const nameById = new Map((chars ?? []).map((c) => [c.id, c.name]));

        let query = supabase
          .from("images")
          .select("*")
          .eq("user_id", userId)
          .not("reviewed_at", "is", null)
          .order("reviewed_at", { ascending: false })
          .limit(limit);

        if (status === "approved" || status === "rejected") query = query.eq("status", status);
        else query = query.in("status", ["approved", "rejected"]);
        if (from) query = query.gte("reviewed_at", from);
        if (to) query = query.lte("reviewed_at", to);
        if (character) {
          const ids = (chars ?? [])
            .filter((c) => c.name.toLowerCase() === character.toLowerCase())
            .map((c) => c.id);
          if (ids.length === 0) return json([]);
          query = query.in("character_id", ids);
        }

        const { data, error } = await query;
        if (error) return json({ error: error.message }, 500);

        const rows = (data ?? []).map((img) => ({
          image_id: img.id,
          filename: img.filename,
          status: img.status,
          reviewed_at: img.reviewed_at,
          reject_reasons: img.reject_reasons ?? (img.reject_reason ? [img.reject_reason] : []),
          comment: img.reject_note ?? null,
          generation_seed: img.generation_seed ?? null,
          generation_prompt: img.generation_prompt ?? null,
          generation_negative_prompt: img.generation_negative_prompt ?? null,
          pose_id: img.pose_id ?? null,
          pose_text: img.pose_text ?? null,
          background_id: img.background_id ?? null,
          background_text: img.background_text ?? null,
          stage: img.content_kind ?? null,
          character: img.character_id ? (nameById.get(img.character_id) ?? null) : null,
        }));

        return json(rows);
      },
    },
  },
});
