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

        let accepted = 0;
        for (const f of files) {
          if (!f.local_path || !f.preview_b64) continue;
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
            pose_id: f.pose_id ?? null,
            background_id: f.background_id ?? null,
          });
          if (error) {
            await supabase.storage.from("previews").remove([previewPath]);
            continue;
          }
          accepted++;
        }
        return json({ accepted, skipped: files.length - accepted });
      },
    },
  },
});
