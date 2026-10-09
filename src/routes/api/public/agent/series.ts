import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * Режим «Отдельные изображения» для агента.
 * GET  — задачи: апскейл выбранного варианта и загрузка готового превью на DA.
 * POST — отчёт: { item_id, status: "upscaled"|"published"|"error", original_local_path?, deviation_url?, error? }
 */
export const Route = createFileRoute("/api/public/agent/series")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        const { data: items } = await supabase
          .from("series_items")
          .select("*, series:series_id(upscale_factor, auto_upscale)")
          .eq("user_id", userId)
          .in("status", ["selected", "preview_ready"])
          .order("updated_at", { ascending: true })
          .limit(5);

        const tasks = [];
        for (const it of items ?? []) {
          if (it.status === "selected" && it.selected_image_id) {
            const { data: img } = await supabase
              .from("images")
              .select("local_path, filename")
              .eq("id", it.selected_image_id)
              .maybeSingle();
            if (!img) continue;
            await supabase.from("series_items").update({ status: "upscaling" }).eq("id", it.id);
            tasks.push({
              type: "upscale",
              item_id: it.id,
              local_path: img.local_path,
              out_name: `${String(it.exclusive_number ?? 0).padStart(3, "0")}_${it.name}`,
              factor: (it.series as { upscale_factor?: number } | null)?.upscale_factor ?? 4,
            });
          } else if (it.status === "preview_ready" && it.censored_preview_path) {
            const { data: signed } = await supabase.storage
              .from("previews")
              .createSignedUrl(it.censored_preview_path, 3600);
            if (!signed) continue;
            await supabase.from("series_items").update({ status: "publishing" }).eq("id", it.id);
            tasks.push({
              type: "publish",
              item_id: it.id,
              preview_url: signed.signedUrl,
              title: it.title,
              description: it.description ?? "",
              tags: it.tags,
              original_local_path: it.original_local_path,
            });
          }
        }
        return json({ tasks });
      },
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;
        const b = (await request.json().catch(() => ({}))) as {
          item_id?: string;
          status?: string;
          original_local_path?: string;
          deviation_url?: string;
          error?: string;
        };
        if (!b.item_id || !["upscaled", "published", "error"].includes(String(b.status))) {
          return json({ error: "bad request" }, 400);
        }
        const patch: Record<string, unknown> = { status: b.status, error: b.error ?? null };
        if (b.original_local_path) patch.original_local_path = b.original_local_path;
        if (b.deviation_url) patch.deviation_url = b.deviation_url;
        const { error } = await supabase
          .from("series_items")
          .update(patch as never)
          .eq("id", b.item_id)
          .eq("user_id", userId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      },
    },
  },
});
