import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * Агент запрашивает ссылку для заливки zip-архива пака в облако,
 * чтобы архив можно было скачать с телефона без доступа к ПК.
 */
export const Route = createFileRoute("/api/public/agent/zip")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        let body: { pack_id?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }
        if (!body.pack_id) return json({ error: "pack_id required" }, 400);

        const { data: pack } = await supabase
          .from("packs")
          .select("id")
          .eq("id", body.pack_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!pack) return json({ error: "pack not found" }, 404);

        const path = `${userId}/${pack.id}.zip`;
        const { data, error } = await supabase.storage
          .from("packs")
          .createSignedUploadUrl(path, { upsert: true });
        if (error) return json({ error: error.message }, 400);

        return json({ upload_url: data.signedUrl, path });
      },
    },
  },
});
