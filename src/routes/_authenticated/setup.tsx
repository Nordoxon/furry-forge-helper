import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/bottom-nav";

export const Route = createFileRoute("/_authenticated/setup")({
  head: () => ({
    meta: [
      { title: "Агент на компьютере — Furry Content Manager" },
      {
        name: "description",
        content: "Ключ доступа и скрипт агента: следит за папкой, апскейлит в Automatic1111 и публикует на DeviantArt.",
      },
      { property: "og:title", content: "Агент на компьютере — Furry Content Manager" },
      {
        property: "og:description",
        content: "Скачайте скрипт, вставьте ключ — компьютер сам присылает превью и публикует одобренное.",
      },
    ],
  }),
  component: SetupPage,
});

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function SetupPage() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const tokens = useQuery({
    queryKey: ["agent-tokens"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_tokens")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function createToken() {
    const { data: userData } = await supabase.auth.getUser();
    await supabase
      .from("agent_tokens")
      .insert({ user_id: userData.user!.id, token: randomToken() });
    void qc.invalidateQueries({ queryKey: ["agent-tokens"] });
  }

  async function revoke(id: string) {
    await supabase.from("agent_tokens").delete().eq("id", id);
    void qc.invalidateQueries({ queryKey: ["agent-tokens"] });
  }

  const token = tokens.data?.[0]?.token ?? "";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold leading-tight">Агент</h1>
            <p className="text-xs text-muted-foreground">Программа на вашем компьютере</p>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => supabase.auth.signOut()}>
            <LogOut className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <KeyRound className="h-4 w-4" /> Ключ доступа
          </h2>
          {tokens.isLoading ? (
            <Loader2 className="mt-3 h-4 w-4 animate-spin text-muted-foreground" />
          ) : token ? (
            <>
              <code className="mt-3 block break-all rounded-lg bg-muted px-3 py-2 text-xs">{token}</code>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(token);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  <Copy className="mr-1 h-4 w-4" /> {copied ? "Скопировано" : "Копировать"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => revoke(tokens.data![0].id)}>
                  Отозвать
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                Ключ связывает программу на компьютере с вашим аккаунтом.
              </p>
              <Button className="mt-3" size="sm" onClick={createToken}>
                Создать ключ
              </Button>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <h2 className="font-display text-base font-semibold">Скрипт агента</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Python-скрипт следит за папкой с генерациями, присылает превью, апскейлит одобренное через
            Automatic1111 и выкладывает на DeviantArt.
          </p>
          <Button asChild className="mt-3" size="sm">
            <a href="/agent/furry_agent.py" download>
              <Download className="mr-1 h-4 w-4" /> Скачать furry_agent.py
            </a>
          </Button>

          <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>1. Установите Python 3.11 и выполните <Code>pip install requests pillow watchdog</Code></li>
            <li>2. Откройте скрипт и заполните блок настроек:</li>
          </ol>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed">
{`API_BASE   = "${origin}"
AGENT_TOKEN = "${token || "ваш-ключ"}"
WATCH_DIR  = r"C:\\stable-diffusion\\outputs"
A1111_URL  = "http://127.0.0.1:7860"
DA_CLIENT_ID / DA_CLIENT_SECRET  # из вашего DeviantArt-приложения`}
          </pre>
          <ol start={3} className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>3. Запустите <Code>python furry_agent.py</Code> — при первом старте он откроет браузер для входа в DeviantArt.</li>
            <li>4. Открывайте этот сайт с телефона и одобряйте кадры.</li>
          </ol>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{children}</code>;
}
