import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json, renderTemplate } from "@/lib/agent-auth";
import { uniqueGirlName } from "@/lib/girl-names";

export const Route = createFileRoute("/api/public/agent/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        const { data: approved } = await supabase
          .from("images")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "approved")
          .order("created_at", { ascending: true })
          .limit(5);

        if (!approved || approved.length === 0) return json({ jobs: [] });

        const { data: chars } = await supabase
          .from("characters")
          .select("*")
          .eq("user_id", userId);
        const charById = new Map((chars ?? []).map((c) => [c.id, c]));

        const { data: tpls } = await supabase
          .from("publish_templates")
          .select("*")
          .eq("user_id", userId);
        const tplById = new Map((tpls ?? []).map((t) => [t.id, t]));
        const defaultTpl = (tpls ?? []).find((t) => t.is_default) ?? null;

        const { data: maxRow } = await supabase
          .from("images")
          .select("seq")
          .eq("user_id", userId)
          .order("seq", { ascending: false })
          .limit(1)
          .maybeSingle();
        let seq = maxRow?.seq ?? 0;

        const { data: usedRows } = await supabase
          .from("images")
          .select("asset_name")
          .eq("user_id", userId)
          .not("asset_name", "is", null);
        const used = new Set(
          (usedRows ?? []).map((r) => String(r.asset_name).toLowerCase()),
        );

        const jobs = [];
        for (const img of approved) {
          const ch = img.character_id ? charById.get(img.character_id) : undefined;
          const tpl = (img.template_id ? tplById.get(img.template_id) : null) ?? defaultTpl;
          seq += 1;
          const assetName = img.asset_name || uniqueGirlName(used);
          const vars = {
            name: assetName,
            character: ch?.name ?? "",
            species: ch?.species ?? "",
            n: seq,
            filename: img.filename.replace(/\.[^.]+$/, ""),
          };
          const title =
            img.title || renderTemplate(ch?.title_template ?? "{filename}", vars) || img.filename;
          const description =
            img.description ||
            renderTemplate(tpl?.description_template || ch?.description_template || "", vars);
          const tags = Array.from(
            new Set(
              [...(ch?.base_tags ?? []), ...(tpl?.tags ?? []), ...(img.tags ?? [])]
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ).slice(0, 30);

          const { error } = await supabase
            .from("images")
            .update({ status: "upscaling", seq, title, description, tags, asset_name: assetName })
            .eq("id", img.id)
            .eq("status", "approved");
          if (error) continue;

          jobs.push({
            id: img.id,
            local_path: img.local_path,
            filename: img.filename,
            asset_name: assetName,
            output_filename: `${assetName}.png`,
            title,
            description,
            tags,
            gallery_folder: img.gallery_folder || ch?.gallery_folder || "",
            is_mature: ch?.is_mature ?? false,
          });
        }
        return json({ jobs });
      },
    },
  },
});
