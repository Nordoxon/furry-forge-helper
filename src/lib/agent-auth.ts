import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export type AgentAuth = { userId: string; supabase: SupabaseClient<Database> };

export async function authenticateAgent(request: Request, bodyToken?: string) {
  const header = request.headers.get("x-agent-token");
  const token = (header || bodyToken || "").trim();
  if (!token) return null;
  const supabase = adminClient();
  const { data } = await supabase
    .from("agent_tokens")
    .select("id, user_id")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  await supabase
    .from("agent_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return { userId: data.user_id, supabase } satisfies AgentAuth;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function renderTemplate(
  template: string,
  vars: { character: string; species: string; n: number; filename: string },
) {
  return (template || "")
    .replaceAll("{character}", vars.character)
    .replaceAll("{species}", vars.species)
    .replaceAll("{filename}", vars.filename)
    .replaceAll("{n}", String(vars.n).padStart(3, "0"));
}
