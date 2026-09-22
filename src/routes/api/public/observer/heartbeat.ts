import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/** Observer mode: подтверждение, что воркер жив. Ничего не меняет в отборе. */
export const Route = createFileRoute("/api/public/observer/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        let body: { worker_id?: string; status?: string; image_id?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }
        const imageId = String(body.image_id ?? "").trim();
        if (imageId) {
          const { data } = await auth.supabase
            .from("images")
            .select("ai_details")
            .eq("id", imageId)
            .eq("user_id", auth.userId)
            .maybeSingle();
          const details = (data?.ai_details ?? {}) as Record<string, unknown>;
          if (details["_state"] === "processing") {
            await auth.supabase
              .from("images")
              .update({
                ai_details: {
                  ...details,
                  _started_at: new Date().toISOString(),
                } as never,
              })
              .eq("id", imageId)
              .eq("user_id", auth.userId);
          }
        }
        return json({
          ok: true,
          worker_id: body.worker_id ?? null,
          status: body.status ?? null,
          server_time: new Date().toISOString(),
        });
      },
    },
  },
});
