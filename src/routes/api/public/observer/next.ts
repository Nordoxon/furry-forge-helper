import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * Observer mode: выдаёт следующий кадр для ИИ-оценки.
 * Ничего в рабочем процессе не меняет: только помечает кадр как «в обработке»
 * через ai_details, чтобы два воркера не взяли один и тот же кадр.
 */
const STALE_MS = 10 * 60 * 1000;
/** Observer оценивает только кадры, созданные после запуска новой системы. */
const OBSERVER_START = "2026-09-22T14:30:00Z";

const handler = (() => {
  return {
    run: async ({ request }: { request: Request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        const url = new URL(request.url);
        const workerId = url.searchParams.get("worker_id") || "worker";

        const { data: rows, error } = await supabase
          .from("images")
          .select(
            "id, filename, local_path, preview_path, ai_details, ai_score, status, content_kind, character_id",
          )
          .eq("user_id", userId)
          .is("ai_score", null)
          .gte("created_at", OBSERVER_START)
          .order("created_at", { ascending: true })
          .limit(50);
        if (error) return json({ error: error.message }, 500);

        const now = Date.now();
        const candidate = (rows ?? []).find((row) => {
          const details = row.ai_details as { _state?: string; _started_at?: string } | null;
          if (!details) return true;
          if (details._state !== "processing") return !details._state;
          const started = Date.parse(details._started_at ?? "");
          return !Number.isFinite(started) || now - started > STALE_MS;
        });
        if (!candidate) return new Response(null, { status: 204 });

        const { data: locked, error: lockError } = await supabase
          .from("images")
          .update({
            ai_details: {
              _state: "processing",
              _worker_id: workerId,
              _started_at: new Date(now).toISOString(),
            } as never,
          })
          .eq("id", candidate.id)
          .eq("user_id", userId)
          .is("ai_score", null)
          .select("id")
          .maybeSingle();
        if (lockError) return json({ error: lockError.message }, 500);
        if (!locked) return new Response(null, { status: 204 });

        let previewUrl: string | null = null;
        if (candidate.preview_path) {
          const { data: signed } = await supabase.storage
            .from("previews")
            .createSignedUrl(candidate.preview_path, 60 * 60);
          previewUrl = signed?.signedUrl ?? null;
        }

        let characterName: string | null = null;
        if (candidate.character_id) {
          const { data: character } = await supabase
            .from("characters")
            .select("name")
            .eq("id", candidate.character_id)
            .eq("user_id", userId)
            .maybeSingle();
          characterName = character?.name ?? null;
        }

        return json({
          id: candidate.id,
          filename: candidate.filename,
          url: previewUrl,
          local_path: candidate.local_path,
          status: candidate.status,
          character: characterName,
          stage: candidate.content_kind ?? null,
        });
    },
  };
})();

export const Route = createFileRoute("/api/public/observer/next")({
  server: {
    handlers: {
      GET: handler.run,
      POST: handler.run,
      HEAD: handler.run,
    },
  },
});
