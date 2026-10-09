import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * GET-подобный POST: агент спрашивает, какие паки пора упаковывать в zip.
 * Пак отдаётся, когда все его изображения уже прошли апскейл (ready/published).
 * POST с { pack_id, zip_path } помечает пак упакованным.
 */
export const Route = createFileRoute("/api/public/agent/packs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        let body: {
          pack_id?: string;
          zip_path?: string;
          zip_local?: string;
          preview_paths?: string[];
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }

        if (body.pack_id) {
          const { error } = await supabase
            .from("packs")
            .update({
              status: "zipped",
              zip_path: body.zip_path ?? null,
              zip_url: body.zip_local ?? null,
              ...(Array.isArray(body.preview_paths)
                ? { preview_paths: body.preview_paths.slice(0, 20) }
                : {}),
            })
            .eq("id", body.pack_id)
            .eq("user_id", userId);
          if (error) return json({ error: error.message }, 400);
          return json({ ok: true });
        }


        const { data: packs } = await supabase
          .from("packs")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "building")
          .order("created_at", { ascending: true })
          .limit(5);

        const result = [];
        for (const pack of packs ?? []) {
          const { data: imgs } = await supabase
            .from("images")
            .select("id, asset_name, filename, status, content_kind, is_preview, is_cover, updated_at")
            .eq("pack_id", pack.id)
            .order("updated_at", { ascending: true });
          const list = imgs ?? [];
          if (list.length === 0) continue;
          const pending = list.filter(
            (i) => i.status !== "ready" && i.status !== "published" && i.status !== "error",
          );
          if (pending.length > 0) continue;
          // обложка делается из одного кадра — первого отмеченного превью
          const coverImg = list.find((i) => i.is_cover) ?? list.find((i) => i.is_preview) ?? list[0];
          result.push({
            id: pack.id,
            title: pack.title,
            sfw_count: pack.sfw_count,
            nsfw_count: pack.nsfw_count,
            caption: `${pack.sfw_count} SFW + ${pack.nsfw_count} NSFW images`,
            description: pack.description ?? "",
            cover: coverImg
              ? {
                  asset_name: coverImg.asset_name,
                  filename: coverImg.filename,
                  output_name: `${coverImg.asset_name}_${String(coverImg.id).slice(0, 6)}`,
                }
              : null,
            files: list.map((i) => ({
              asset_name: i.asset_name,
              output_name: `${i.asset_name}_${String(i.id).slice(0, 6)}`,
              filename: i.filename,
              content_kind: i.content_kind,
              is_preview: i.is_preview,
            })),
          });
        }
        return json({ packs: result });
      },
    },
  },
});
