import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";
import { renderDescription } from "@/lib/series-description";

/**
 * Режим «Отдельные эксклюзивы» для агента. По одной задаче на персонажа, по состоянию:
 *  selected                          → upscale
 *  upscaled + auto_censor + шаблон   → censor_and_publish
 *  preview_ready                     → publish
 *  published + авто + нет оригинала  → source_upload
 *  published + оригинал + pending    → listing
 * POST — отчёт: status = upscaled | censor_done | preview_published | preview_draft |
 *        source_uploaded | listing_result | published | error
 */
const STUCK_MS = 30 * 60 * 1000;

export const Route = createFileRoute("/api/public/agent/series")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;
        const cutoff = new Date(Date.now() - STUCK_MS).toISOString();

        // восстановление зависших
        await supabase.from("series_items").update({ status: "selected" }).eq("user_id", userId).eq("status", "upscaling").lt("updated_at", cutoff);
        await supabase
          .from("series_items")
          .update({ status: "preview_ready" })
          .eq("user_id", userId)
          .eq("status", "publishing")
          .not("censored_preview_path", "is", null)
          .lt("updated_at", cutoff);
        await supabase
          .from("series_items")
          .update({ status: "upscaled" })
          .eq("user_id", userId)
          .eq("status", "publishing")
          .is("censored_preview_path", null)
          .lt("updated_at", cutoff);
        await supabase
          .from("series_items")
          .update({ listing_status: "pending" })
          .eq("user_id", userId)
          .eq("listing_status", "in_progress")
          .lt("listing_started_at", cutoff);

        const { data: st } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
        const s = st ?? ({} as Partial<NonNullable<typeof st>>);
        const auto = !!s.auto_publish_exclusive;
        const preset = Array.isArray(s.censor_preset) ? s.censor_preset : [];

        const { data: items } = await supabase
          .from("series_items")
          .select("*, series:series_id(upscale_factor, auto_upscale, scene_name, watermark)")
          .eq("user_id", userId)
          .in("status", ["selected", "upscaled", "preview_ready", "published"])
          .order("updated_at", { ascending: true })
          .limit(20);

        const tagsFor = async (it: { character_id: string | null; name: string }) => {
          if (it.character_id) {
            const { data: ch } = await supabase.from("characters").select("base_tags").eq("id", it.character_id).maybeSingle();
            if (ch?.base_tags?.length) return ch.base_tags.slice(0, 30);
          }
          return Array.from(new Set([...(s.default_tags ?? []), it.name.trim()].filter(Boolean))).slice(0, 30);
        };
        const now = new Date().toISOString();

        const tasks: Record<string, unknown>[] = [];
        for (const it of items ?? []) {
          if (tasks.length >= 5) break;
          const ser = (it.series ?? {}) as { upscale_factor?: number; scene_name?: string; watermark?: boolean };
          const publishFields = async () => ({
            item_id: it.id,
            title: it.title,
            description: renderDescription(it.description, s.description_template, {
              number: it.exclusive_number,
              character: it.name,
              scene: ser.scene_name ?? "",
            }),
            tags: await tagsFor(it),
            is_mature: true,
            mature_level: s.mature_level ?? "moderate",
            mature_classification: s.mature_classification ?? ["nudity", "sexual"],
            gallery_folder: s.gallery_folder ?? "",
            auto_publish: auto,
            original_local_path: it.original_local_path,
          });

          if (it.status === "selected" && it.selected_image_id) {
            const { data: img } = await supabase.from("images").select("local_path").eq("id", it.selected_image_id).maybeSingle();
            if (!img) continue;
            await supabase.from("series_items").update({ status: "upscaling" }).eq("id", it.id);
            tasks.push({
              type: "upscale",
              item_id: it.id,
              local_path: img.local_path,
              out_name: `${String(it.exclusive_number ?? 0).padStart(3, "0")}_${it.name}`,
              factor: ser.upscale_factor ?? 4,
            });
          } else if (it.status === "upscaled" && s.auto_censor && preset.length && it.selected_image_id) {
            const { data: img } = await supabase.from("images").select("preview_path").eq("id", it.selected_image_id).maybeSingle();
            if (!img?.preview_path) continue;
            const { data: signed } = await supabase.storage.from("previews").createSignedUrl(img.preview_path, 3600);
            if (!signed) continue;
            await supabase.from("series_items").update({ status: "publishing" }).eq("id", it.id);
            tasks.push({
              type: "censor_and_publish",
              ...(await publishFields()),
              preview_url: signed.signedUrl,
              censor_preset: preset,
              censor_style: s.censor_style ?? "pixel",
              watermark: ser.watermark === false ? "" : `#${it.exclusive_number ?? ""}`,
            });
          } else if (it.status === "preview_ready" && it.censored_preview_path) {
            const { data: signed } = await supabase.storage.from("previews").createSignedUrl(it.censored_preview_path, 3600);
            if (!signed) continue;
            await supabase.from("series_items").update({ status: "publishing" }).eq("id", it.id);
            tasks.push({ type: "publish", ...(await publishFields()), preview_url: signed.signedUrl });
          } else if (it.status === "published" && auto && it.listing_status === "pending") {
            if (!it.source_stash_item_id && it.original_local_path) {
              await supabase.from("series_items").update({ listing_status: "in_progress", listing_started_at: now }).eq("id", it.id);
              tasks.push({ type: "source_upload", item_id: it.id, local_path: it.original_local_path, title: `SOURCE — ${it.title}` });
            } else if (it.source_stash_item_id && it.deviation_url) {
              await supabase.from("series_items").update({ listing_status: "in_progress", listing_started_at: now, listing_error: null }).eq("id", it.id);
              tasks.push({
                type: "listing",
                item_id: it.id,
                deviation_url: it.deviation_url,
                title: it.title,
                original_local_path: it.original_local_path,
                source_stash_item_id: it.source_stash_item_id,
                source_stash_url: it.source_stash_url,
                price: Number(s.exclusive_price ?? 15),
                sale_type: s.exclusive_sale_type ?? "fixed",
                topic: s.exclusive_topic ?? "Adoptable",
                allow_resales: s.allow_resales ?? true,
                early_access: s.early_access ?? false,
                listing_confirm: s.listing_confirm ?? true,
              });
            }
          }
        }
        return json({ tasks });
      },
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;
        const b = (await request.json().catch(() => ({}))) as Record<string, unknown> & { item_id?: string; status?: string };
        const str = (v: unknown) => (typeof v === "string" && v ? v : null);
        const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
        let patch: Record<string, unknown>;
        switch (b.status) {
          case "upscaled":
            patch = { status: "upscaled", error: null, ...(b.original_local_path ? { original_local_path: b.original_local_path } : {}) };
            break;
          case "censor_done":
            patch = { error: null };
            break;
          case "published":
          case "preview_published":
            patch = {
              status: "published",
              error: null,
              deviation_url: str(b.deviation_url),
              ...(b.preview_stash_item_id ? { preview_stash_item_id: num(b.preview_stash_item_id) } : {}),
            };
            break;
          case "preview_draft":
            patch = { status: "draft", error: null, preview_stash_item_id: num(b.preview_stash_item_id) };
            break;
          case "source_uploaded":
            patch = {
              source_stash_item_id: num(b.itemid),
              source_stash_url: str(b.url),
              listing_status: "pending",
              listing_error: null,
            };
            break;
          case "listing_result":
            patch = {
              listing_status: b.listing_status === "listed" ? "listed" : b.listing_status === "manual" ? "manual" : "failed",
              listing_error: str(b.error),
            };
            break;
          case "error":
            patch = { status: "error", error: str(b.error) };
            break;
          default:
            return json({ error: "bad request" }, 400);
        }
        if (!b.item_id) return json({ error: "bad request" }, 400);
        const { error } = await supabase.from("series_items").update(patch as never).eq("id", b.item_id).eq("user_id", userId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      },
    },
  },
});
