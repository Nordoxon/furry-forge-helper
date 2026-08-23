import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

const ALLOWED = new Set(["upscaling", "uploading", "published", "error", "approved"]);

export const Route = createFileRoute("/api/public/agent/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);

        let body: {
          id?: string;
          status?: string;
          deviation_url?: string | null;
          error?: string | null;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        if (!body.id || !body.status || !ALLOWED.has(body.status)) {
          return json({ error: "bad request" }, 400);
        }

        const { error } = await auth.supabase
          .from("images")
          .update({
            status: body.status as "published",
            deviation_url: body.deviation_url ?? null,
            error: body.error ?? null,
          })
          .eq("id", body.id)
          .eq("user_id", auth.userId);

        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      },
    },
  },
});
