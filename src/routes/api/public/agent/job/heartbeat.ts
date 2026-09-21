import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * Агент раз в полминуты подтверждает, что он жив и всё ещё работает
 * над своим заданием. Это надёжнее, чем ждать 30 минут по таймауту.
 */
export const Route = createFileRoute("/api/public/agent/job/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        let body: { generation_job_id?: string; worker?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const jobId = String(body.generation_job_id || "");
        if (!jobId) return json({ error: "bad request" }, 400);

        const { data: job } = await supabase
          .from("generation_jobs")
          .select("id, status, worker")
          .eq("user_id", userId)
          .eq("id", jobId)
          .maybeSingle();
        if (!job) return json({ error: "unknown job" }, 404);

        const worker = String(body.worker || "").slice(0, 60);
        // задание могло быть перехвачено другим воркером — тогда этот должен остановиться
        if (worker && job.worker && job.worker !== worker) {
          return json({ ok: false, owned: false, status: job.status });
        }

        await supabase
          .from("generation_jobs")
          .update({ heartbeat_at: new Date().toISOString() })
          .eq("id", jobId)
          .eq("user_id", userId);

        return json({ ok: true, owned: true, status: job.status });
      },
    },
  },
});
