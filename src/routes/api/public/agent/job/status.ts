import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

const ALLOWED = new Set([
  "QUEUED",
  "CLAIMED",
  "GENERATING",
  "UPLOADING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/** Агент сообщает, на каком шаге находится его единственное задание. */
export const Route = createFileRoute("/api/public/agent/job/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        let body: {
          generation_job_id?: string;
          status?: string;
          error?: string | null;
          seed?: number | string | null;
          failure_kind?: string | null;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid json" }, 400);
        }

        const jobId = String(body.generation_job_id || "");
        const status = String(body.status || "").toUpperCase();
        if (!jobId || !ALLOWED.has(status)) return json({ error: "bad request" }, 400);

        const { data: job } = await supabase
          .from("generation_jobs")
          .select("id, status, attempts, max_attempts")
          .eq("user_id", userId)
          .eq("id", jobId)
          .maybeSingle();
        if (!job) return json({ error: "unknown job" }, 404);
        // завершённое задание второй раз не переоткрываем
        if (job.status === "COMPLETED") return json({ ok: true, status: "COMPLETED" });

        const seedNum = Number(body.seed);
        const now = new Date().toISOString();
        const failureKind = String(body.failure_kind || "").toLowerCase();
        const patch: Record<string, unknown> = { status, heartbeat_at: now };
        if (body.error !== undefined) patch["error"] = body.error;
        if (Number.isFinite(seedNum)) patch["seed"] = Math.trunc(seedNum);
        if (status === "GENERATING") patch["started_at"] = now;

        let retry = false;
        let attempts = job.attempts ?? 0;
        if (status === "FAILED") {
          patch["failure_kind"] = failureKind || "generation";
          if (failureKind === "upload") {
            // кадр уже сгенерирован: задание остаётся в загрузке, агент дошлёт файл
            patch["status"] = "UPLOADING";
          } else {
            attempts += 1;
            patch["attempts"] = attempts;
            const limit = job.max_attempts ?? 3;
            retry = attempts < limit;
            // пока лимит попыток не исчерпан — задание возвращается в очередь
            patch["status"] = retry ? "QUEUED" : "FAILED";
            if (!retry) patch["completed_at"] = now;
          }
        }
        if (status === "COMPLETED" || status === "CANCELLED") patch["completed_at"] = now;

        const { error } = await supabase
          .from("generation_jobs")
          .update(patch as never)
          .eq("id", jobId)
          .eq("user_id", userId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, status: patch["status"], attempts, retry });
      },
    },
  },
});
