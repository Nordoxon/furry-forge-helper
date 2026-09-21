import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";
import { genPlan, genSettings } from "@/lib/agent-phase";
import { applyScene, pickScene } from "@/lib/scene";

const STALE_MINUTES = 30;
// задание считается брошенным, если воркер давно не подавал признаков жизни
const HEARTBEAT_STALE_MINUTES = 5;

/**
 * Очередь на одно изображение: агент берёт ровно одно задание,
 * генерирует его через Forge API и только после подтверждения загрузки
 * просит следующее. Этап (SFW/NSFW) решает сервер.
 */
export const Route = createFileRoute("/api/public/agent/job/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        let body: { worker?: string } = {};
        try {
          body = (await request.json()) as { worker?: string };
        } catch {
          body = {};
        }
        const worker = String(body.worker || "agent").slice(0, 60);

        // 1. восстановление после перезапуска агента
        const now = Date.now();
        const staleBefore = new Date(now - STALE_MINUTES * 60_000).toISOString();
        const heartbeatStale = new Date(now - HEARTBEAT_STALE_MINUTES * 60_000).toISOString();
        // брошенные задания (воркер молчит) возвращаем в очередь, а не теряем
        await supabase
          .from("generation_jobs")
          .update({ status: "QUEUED", worker: null, error: "воркер замолчал, задание возвращено" })
          .eq("user_id", userId)
          .in("status", ["CLAIMED", "GENERATING"])
          .not("heartbeat_at", "is", null)
          .lt("heartbeat_at", heartbeatStale);
        await supabase
          .from("generation_jobs")
          .update({ status: "QUEUED", worker: null, error: "задание зависло и было возвращено" })
          .eq("user_id", userId)
          .in("status", ["CLAIMED", "GENERATING", "UPLOADING"])
          .is("heartbeat_at", null)
          .lt("updated_at", staleBefore);

        // задания, чей кадр уже принят сайтом, закрываем без повторной генерации
        const { data: activeJobs } = await supabase
          .from("generation_jobs")
          .select("*")
          .eq("user_id", userId)
          .in("status", ["QUEUED", "CLAIMED", "GENERATING", "UPLOADING"])
          .order("created_at", { ascending: true });

        for (const job of activeJobs ?? []) {
          const { data: img } = await supabase
            .from("images")
            .select("id")
            .eq("user_id", userId)
            .eq("generation_job_id", job.id)
            .maybeSingle();
          if (img) {
            await supabase
              .from("generation_jobs")
              .update({
                status: "COMPLETED",
                image_id: img.id,
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            continue;
          }
          // задание уже ведёт другой живой воркер — второй его не перехватывает
          const beat = job.heartbeat_at ? Date.parse(job.heartbeat_at) : 0;
          if (job.worker && job.worker !== worker && beat > now - HEARTBEAT_STALE_MINUTES * 60_000) {
            return json({ job: null, reason: `задание ведёт другой воркер: ${job.worker}` });
          }
          // ровно одно активное задание на воркера: отдаём то же самое
          await supabase
            .from("generation_jobs")
            .update({
              status: "CLAIMED",
              worker,
              claimed_at: new Date().toISOString(),
              heartbeat_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          return json({
            job: {
              generation_job_id: job.id,
              phase: job.phase,
              prompt: job.prompt,
              negative_prompt: job.negative_prompt,
              settings: job.settings,
              pose_id: job.pose_id,
              pose_text: job.pose_text,
              background_id: job.background_id,
              background_text: job.background_text,
              resume: true,
            },
          });
        }

        // 2. новое задание по текущему состоянию сайта
        const plan = await genPlan(supabase, userId);
        if (!plan.generate || !plan.character) {
          return json({
            job: null,
            phase: plan.phase,
            reason: plan.reason,
            progress: {
              sfw: plan.sfw,
              nsfw: plan.nsfw,
              sfw_target: plan.character?.sfw_target ?? 0,
              nsfw_target: plan.character?.nsfw_target ?? 0,
            },
          });
        }

        const settings = genSettings(plan.character);
        const { data: created, error } = await supabase
          .from("generation_jobs")
          .insert({
            user_id: userId,
            character_id: plan.character.id,
            phase: plan.phase,
            prompt: plan.prompt,
            negative_prompt: plan.negative_prompt,
            settings,
            status: "CLAIMED",
            worker,
            claimed_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error || !created) return json({ error: error?.message ?? "insert failed" }, 500);

        return json({
          job: {
            generation_job_id: created.id,
            phase: plan.phase,
            prompt: plan.prompt,
            negative_prompt: plan.negative_prompt,
            settings,
            character: plan.character.name,
            resume: false,
          },
          progress: {
            sfw: plan.sfw,
            nsfw: plan.nsfw,
            sfw_target: plan.character.sfw_target,
            nsfw_target: plan.character.nsfw_target,
          },
        });
      },
    },
  },
});
