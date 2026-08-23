import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { fetchPipeline, signedPreview, STATUS_LABELS, type ImageRow } from "@/lib/images";

export const Route = createFileRoute("/_authenticated/queue")({
  head: () => ({
    meta: [
      { title: "Очередь публикации — Furry Content Manager" },
      {
        name: "description",
        content: "Следите за апскейлом и загрузкой одобренных изображений на DeviantArt в реальном времени.",
      },
      { property: "og:title", content: "Очередь публикации — Furry Content Manager" },
      {
        property: "og:description",
        content: "Статусы обработки: апскейл, загрузка, опубликовано, ошибки.",
      },
    ],
  }),
  component: QueuePage,
});

const STATUS_CLASS: Record<string, string> = {
  approved: "bg-primary/15 text-primary",
  upscaling: "bg-accent text-accent-foreground",
  uploading: "bg-accent text-accent-foreground",
  published: "bg-emerald-500/15 text-emerald-400",
  rejected: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
};

export function QueuePage() {
  const q = useQuery({ queryKey: ["pipeline"], queryFn: fetchPipeline, refetchInterval: 10000 });
  const items = q.data ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto max-w-2xl">
          <h1 className="font-display text-lg font-semibold leading-tight">Очередь</h1>
          <p className="text-xs text-muted-foreground">Что сейчас делает компьютер</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {q.isLoading ? (
          <div className="grid h-40 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-border p-8 text-center">
            <h2 className="font-display text-lg font-semibold">Очередь пуста</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Одобрите пару кадров на вкладке «Отбор» — они появятся здесь.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <Row key={it.id} item={it} />
            ))}
          </ul>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function Row({ item }: { item: ImageRow }) {
  const { data: url } = useQuery({
    queryKey: ["preview", item.id],
    queryFn: () => signedPreview(item.preview_path),
  });

  return (
    <li className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
        {url && <img src={url} alt={item.filename} className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title || item.filename}</p>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              STATUS_CLASS[item.status] ?? "bg-muted text-muted-foreground"
            }`}
          >
            {STATUS_LABELS[item.status]}
          </span>
          {item.error && (
            <span className="flex items-center gap-1 truncate text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {item.error}
            </span>
          )}
        </div>
      </div>
      {item.deviation_url && (
        <a
          href={item.deviation_url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg p-2 text-muted-foreground hover:text-foreground"
          aria-label="Открыть публикацию"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </li>
  );
}
