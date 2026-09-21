import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BottomNav } from "@/components/bottom-nav";
import { fetchSceneUsage, fetchScenes, setSceneEnabled, type SceneKind } from "@/lib/scene-library";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Сцены: позы и фоны — Furry Content Manager" },
      {
        name: "description",
        content: "Библиотека из 60 поз и 100 фонов: просмотр, фильтр по категориям и отключение неудачных вариантов.",
      },
      { property: "og:title", content: "Сцены: позы и фоны — Furry Content Manager" },
      {
        property: "og:description",
        content: "Сайт сам подбирает позу и фон для каждой генерации из этой библиотеки.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SceneKind>("poses");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const items = useQuery({ queryKey: ["scenes", kind], queryFn: () => fetchScenes(kind) });
  const usage = useQuery({ queryKey: ["scene-usage", kind], queryFn: () => fetchSceneUsage(kind) });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setSceneEnabled(kind, id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", kind] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const categories = useMemo(() => {
    const set = new Set((items.data ?? []).map((i) => i.category));
    return ["all", ...Array.from(set).sort()];
  }, [items.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items.data ?? []).filter(
      (i) =>
        (category === "all" || i.category === category) &&
        (!q || i.code.toLowerCase().includes(q) || i.prompt.toLowerCase().includes(q)),
    );
  }, [items.data, search, category]);

  const enabledCount = (items.data ?? []).filter((i) => i.enabled).length;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-6 pt-5">
        <h1 className="font-display text-2xl font-semibold">Сцены</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Для каждой генерации сайт сам берёт свободную позу и фон и дописывает их к промпту.
        </p>

        <Tabs value={kind} onValueChange={(v) => { setKind(v as SceneKind); setCategory("all"); }} className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="poses" className="flex-1">
              Позы
            </TabsTrigger>
            <TabsTrigger value="backgrounds" className="flex-1">
              Фоны
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру или тексту"
            className="pl-9"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                category === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground"
              }`}
            >
              {c === "all" ? "Все" : c}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Включено {enabledCount} из {items.data?.length ?? 0} · показано {visible.length}
        </p>

        {items.isLoading ? (
          <div className="mt-8 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {visible.map((item) => {
              const stat = usage.data?.get(item.code);
              return (
                <li
                  key={item.id}
                  className="rounded-xl border border-border/60 bg-card px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.code}</p>
                      <p className="text-[11px] text-muted-foreground">{item.category}</p>
                    </div>
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={(v) => toggle.mutate({ id: item.id, enabled: v })}
                    />
                  </div>
                  <p className="mt-1.5 break-words text-xs text-muted-foreground">{item.prompt}</p>
                  {stat && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Использовано {stat.total} · оставлено {stat.approved} · отклонено {stat.rejected}
                    </p>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                Ничего не найдено
              </li>
            )}
          </ul>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
