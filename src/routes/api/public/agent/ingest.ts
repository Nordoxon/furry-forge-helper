import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

type IncomingFile = {
  filename: string;
  local_path: string;
  width?: number;
  height?: number;
  preview_b64: string;
  seed?: number | string | null;
  prompt?: string | null;
  negative_prompt?: string | null;
  pose_id?: string | null;
  background_id?: string | null;
  generation_job_id?: string | null;
  generation_settings?: Record<string, unknown> | null;
};

function toSeed(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const Route = createFileRoute("/api/public/agent/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);

        let body: { files?: IncomingFile[] };
        try {
          body = (await request.json()) as { files?: IncomingFile[] };
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const files = Array.isArray(body.files) ? body.files.slice(0, 50) : [];
        if (files.length === 0) return json({ accepted: 0, skipped: 0 });

        const { supabase, userId } = auth;
        const paths = files.map((f) => String(f.local_path || ""));
        const { data: existing } = await supabase
          .from("images")
          .select("local_path")
          .eq("user_id", userId)
          .in("local_path", paths);
        const known = new Set((existing ?? []).map((r) => r.local_path));

        // повторная отправка того же задания не создаёт второй кадр
        const jobIds = files
          .map((f) => String(f.generation_job_id || ""))
          .filter(Boolean);
        const { data: jobImages } = jobIds.length
          ? await supabase
              .from("images")
              .select("id, generation_job_id")
              .eq("user_id", userId)
              .in("generation_job_id", jobIds)
          : { data: [] as { id: string; generation_job_id: string | null }[] };
        const imageByJob = new Map(
          (jobImages ?? []).map((r) => [String(r.generation_job_id), r.id]),
        );

        // поза и фон известны сайту: берём их из задания, агент их присылать не обязан
        const { data: jobRows } = jobIds.length
          ? await supabase
              .from("generation_jobs")
              .select("id, pose_id, pose_text, background_id, background_text")
              .eq("user_id", userId)
              .in("id", jobIds)
          : { data: [] as { id: string; pose_id: string | null; pose_text: string | null; background_id: string | null; background_text: string | null }[] };
        const sceneByJob = new Map((jobRows ?? []).map((r) => [String(r.id), r]));

        const completeJob = async (jobId: string, imageId: string) => {
          await supabase
            .from("generation_jobs")
            .update({
              status: "COMPLETED",
              image_id: imageId,
              completed_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("id", jobId);
        };

        let accepted = 0;
        let duplicates = 0;
        const acks: { generation_job_id: string; image_id: string; duplicate: boolean }[] = [];
        for (const f of files) {
          if (!f.local_path || !f.preview_b64) continue;
          const jobId = String(f.generation_job_id || "");
          if (jobId && imageByJob.has(jobId)) {
            const imageId = imageByJob.get(jobId)!;
            await completeJob(jobId, imageId);
            acks.push({ generation_job_id: jobId, image_id: imageId, duplicate: true });
            duplicates++;
            continue;
          }
          if (known.has(f.local_path)) continue;
          const id = crypto.randomUUID();
          const previewPath = `${userId}/${id}.jpg`;
          const upload = await supabase.storage
            .from("previews")
            .upload(previewPath, decodeBase64(f.preview_b64), {
              contentType: "image/jpeg",
              upsert: true,
            });
          if (upload.error) continue;
          const { error } = await supabase.from("images").insert({
            id,
            user_id: userId,
            filename: f.filename || f.local_path.split(/[\\/]/).pop() || "image",
            local_path: f.local_path,
            preview_path: previewPath,
            width: f.width ?? null,
            height: f.height ?? null,
            status: "new",
            generation_seed: toSeed(f.seed),
            generation_prompt: f.prompt ?? null,
            generation_negative_prompt: f.negative_prompt ?? null,
            pose_id: f.pose_id ?? sceneByJob.get(jobId)?.pose_id ?? null,
            pose_text: sceneByJob.get(jobId)?.pose_text ?? null,
            background_id: f.background_id ?? sceneByJob.get(jobId)?.background_id ?? null,
            background_text: sceneByJob.get(jobId)?.background_text ?? null,
            generation_job_id: jobId || null,
            generation_settings: (f.generation_settings ?? null) as never,
          });
          if (error) {
            await supabase.storage.from("previews").remove([previewPath]);
            continue;
          }
          if (jobId) {
            imageByJob.set(jobId, id);
            await completeJob(jobId, id);
            acks.push({ generation_job_id: jobId, image_id: id, duplicate: false });
          }
          accepted++;
        }
        return json({
          accepted,
          duplicates,
          skipped: files.length - accepted - duplicates,
          acks,
        });
      },
    },
  },
});
