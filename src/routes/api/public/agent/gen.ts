import { createFileRoute } from "@tanstack/react-router";
import { authenticateAgent, json } from "@/lib/agent-auth";

/**
 * Агент спрашивает: нужно ли продолжать генерацию и с каким промптом.
 * Генерация останавливается, как только набрано 8 SFW (потом 23 NSFW).
 */
export const Route = createFileRoute("/api/public/agent/gen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateAgent(request);
        if (!auth) return json({ error: "invalid token" }, 401);
        const { supabase, userId } = auth;

        const { data: chars } = await supabase
          .from("characters")
          .select("*")
          .eq("user_id", userId)
          .eq("generation_enabled", true)
          .eq("prompt_approved", true)
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: false });

        const character = (chars ?? [])[0];
        if (!character) {
          return json({
            generate: false,
            reason: "Нет персонажа с подтверждённым промптом",
            phase: "idle",
            prompt: "",
          });
        }

        const { data: picked } = await supabase
          .from("images")
          .select("content_kind")
          .eq("user_id", userId)
          .eq("character_id", character.id)
          .is("pack_id", null)
          .in("status", ["approved", "upscaling", "uploading", "ready", "published"]);

        const list = picked ?? [];
        const sfw = list.filter((i) => i.content_kind === "sfw").length;
        const nsfw = list.length - sfw;

        let phase: "sfw" | "nsfw" | "done" = "sfw";
        if (sfw >= character.sfw_target) phase = nsfw >= character.nsfw_target ? "done" : "nsfw";

        const prompt = phase === "sfw" ? character.sfw_prompt : phase === "nsfw" ? character.nsfw_prompt : "";

        return json({
          generate: phase !== "done" && Boolean(prompt.trim()),
          phase,
          prompt,
          character: character.name,
          settings: {
            width: character.gen_width,
            height: character.gen_height,
            cfg_scale: Number(character.gen_cfg),
            steps: character.gen_steps,
            sampler_name: character.gen_sampler,
            batch_count: character.gen_batch_count,
            style: character.gen_style,
          },
          progress: { sfw, nsfw, sfw_target: character.sfw_target, nsfw_target: character.nsfw_target },
          reason:
            phase === "done"
              ? "Отбор закрыт — генерация остановлена"
              : prompt.trim()
                ? ""
                : `Пустой промпт для этапа ${phase}`,
        });
      },
    },
  },
});
