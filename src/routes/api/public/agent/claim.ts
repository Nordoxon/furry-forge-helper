import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json, renderTemplate } from "@/lib/agent-auth";
/** Имя файла/работы: имя персонажа + порядковый номер (Lucario_001). */
function characterAssetName(characterName: string | undefined, used: Set<string>) {
  const base = (characterName || "Image").replace(/[^A-Za-z0-9]+/g, "") || "Image";
  let i = 1;
  let candidate = `${base}_${String(i).padStart(3, "0")}`;
  while (used.has(candidate.toLowerCase())) {
    i += 1;
    candidate = `${base}_${String(i).padStart(3, "0")}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export const Route = createFileRoute("/api/public/agent/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        // Возвращаем в очередь задания, зависшие в обработке (агент упал/перезапустился)
        const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        await supabase
          .from("images")
          .update({ status: "approved" })
          .eq("user_id", userId)
          .in("status", ["upscaling", "uploading"])
          .lt("updated_at", staleBefore);

        // Апскейл начинается только после закрытия пака. Сначала явно находим
        // активные паки пользователя, затем забираем их кадры. Это надёжнее
        // косвенной проверки pack_id и не позволяет смешивать старые задания.
        const { data: activePacks, error: packsError } = await supabase
          .from("packs")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "building")
          .order("created_at", { ascending: true })
          .limit(5);
        if (packsError) return json({ error: packsError.message }, 500);

        const activePackIds = (activePacks ?? []).map((pack) => pack.id);
        console.log("[claim] user", userId, "packs", JSON.stringify(activePackIds));
        if (activePackIds.length === 0) return json({ jobs: [] });

        const { data: approved, error: approvedError } = await supabase
          .from("images")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "approved")
          .in("pack_id", activePackIds)
          .order("created_at", { ascending: true })
          .limit(5);

        if (approvedError) return json({ error: approvedError.message }, 500);

        console.log("[claim] approved", approved?.length ?? -1, approvedError?.message ?? "");
        if (!approved || approved.length === 0) return json({ jobs: [] });

        const { data: chars } = await supabase
          .from("characters")
          .select("*")
          .eq("user_id", userId);
        const charById = new Map((chars ?? []).map((c) => [c.id, c]));




        // Нумерация файлов и seq считается внутри пака и всегда начинается с единицы
        const packIds = Array.from(
          new Set(approved.map((i) => i.pack_id).filter((v): v is string => Boolean(v))),
        );
        const { data: packRows } = await supabase
          .from("images")
          .select("pack_id, seq, asset_name")
          .eq("user_id", userId)
          .in("pack_id", packIds.length > 0 ? packIds : ["00000000-0000-0000-0000-000000000000"]);
        const usedByPack = new Map<string, Set<string>>();
        const seqByPack = new Map<string, number>();
        for (const row of packRows ?? []) {
          const key = String(row.pack_id);
          if (!usedByPack.has(key)) usedByPack.set(key, new Set());
          if (row.asset_name) usedByPack.get(key)!.add(String(row.asset_name).toLowerCase());
          seqByPack.set(key, Math.max(seqByPack.get(key) ?? 0, row.seq ?? 0));
        }

        const jobs = [];
        for (const img of approved) {
          const ch = img.character_id ? charById.get(img.character_id) : undefined;
          const packKey = String(img.pack_id);
          if (!usedByPack.has(packKey)) usedByPack.set(packKey, new Set());
          const used = usedByPack.get(packKey)!;
          const seq = (seqByPack.get(packKey) ?? 0) + 1;
          seqByPack.set(packKey, seq);
          const assetName = img.asset_name || characterAssetName(ch?.name, used);
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
            img.description || renderTemplate(ch?.description_template || "", vars);
          const tags = Array.from(
            new Set(
              [...(ch?.base_tags ?? []), ...(img.tags ?? [])].map((t) => t.trim()).filter(Boolean),
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
            content_kind: img.content_kind,
            upload_to_da: img.is_cover,
            // на диске имя уникально, внутри пака — короткое с нумерацией от единицы
            output_filename: `${assetName}_${String(img.id).slice(0, 6)}.png`,
            title,
            description,
            tags,
            gallery_folder: "",
            is_mature: ch?.is_mature ?? false,
            template: null,
          });
        }
        return json({ jobs });
      },
    },
  },
});
