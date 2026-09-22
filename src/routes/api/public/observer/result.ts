import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * Observer mode: сохраняет результат ИИ-оценки.
 * Статус кадра и отбор человеком не затрагиваются.
 */
type Body = {
  id?: string;
  image_id?: string;
  filename?: string;
  ai_score?: number | null;
  ai_decision?: string | null;
  ai_details?: Record<string, unknown> | null;
  model?: string | null;
  evaluator_version?: string | null;
  processing_time_ms?: number | null;
  worker_id?: string | null;
};

export const Route = createFileRoute("/api/public/observer/result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const id = String(body.id ?? "").trim();
        if (!id) return json({ error: "id is required" }, 400);

        const score =
          body.ai_score === null || body.ai_score === undefined ? null : Number(body.ai_score);
        if (score !== null && !Number.isFinite(score)) {
          return json({ error: "ai_score must be a number" }, 400);
        }

        const details = {
          ...(body.ai_details ?? {}),
          _state: "done",
          model: body.model ?? null,
          evaluator_version: body.evaluator_version ?? null,
          processing_time_ms: body.processing_time_ms ?? null,
          worker_id: body.worker_id ?? null,
          evaluated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from("images")
          .update({
            ai_score: score,
            ai_decision: body.ai_decision ?? "observer",
            ai_details: details as never,
          })
          .eq("id", id)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "image not found" }, 404);

        return json({ ok: true, id });
      },
    },
  },
});
