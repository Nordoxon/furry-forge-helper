import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Inbox, Undo2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/bottom-nav";
import {
  decide,
  fetchCharacters,
  fetchInbox,
  signedPreview,
  type ImageRow,
} from "@/lib/images";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Отбор изображений — Furry Content Manager" },
      {
        name: "description",
        content: "Быстрый отбор свежих генераций с телефона: одобряйте кадры, остальное сделает агент на компьютере.",
      },
      { property: "og:title", content: "Отбор изображений — Furry Content Manager" },
      {
        property: "og:description",
        content: "Одобряйте генерации в один тап — апскейл и публикация запускаются автоматически.",
      },
    ],
  }),
  component: TriagePage,
});

function TriagePage() {
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [charId, setCharId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [last, setLast] = useState<{ id: string } | null>(null);

  const inbox = useQuery({ queryKey: ["inbox"], queryFn: fetchInbox, refetchInterval: 20000 });
  const chars = useQuery({ queryKey: ["characters"], queryFn: fetchCharacters });

  useEffect(() => {
    if (charId === null && chars.data?.length) {
      setCharId((chars.data.find((c) => c.is_default) ?? chars.data[0]).id);
    }
  }, [chars.data, charId]);

  const activeChar = useMemo(
    () => chars.data?.find((c) => c.id === charId) ?? null,
    [chars.data, charId],
  );

  // папка по умолчанию — из персонажа; сбрасываем выбор при смене персонажа
  useEffect(() => {
    setFolder(null);
  }, [charId]);

  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of chars.data ?? []) if (c.gallery_folder) set.add(c.gallery_folder);
    for (const f of extraFolders) set.add(f);
    return Array.from(set);
  }, [chars.data, extraFolders]);

  const items = inbox.data ?? [];
  const current = items[index];

  async function act(status: "approved" | "rejected") {
    if (!current) return;
    try {
      await decide(current.id, status, charId, status === "approved" ? folder : null);
      setLast({ id: current.id });
      setIndex((i) => i + 1);
      setFolder(null);
      void qc.invalidateQueries({ queryKey: ["pipeline"] });
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    }
  }

  async function undo() {
    if (!last) return;
    try {
      await decide(last.id, "new", null, null);
      setLast(null);
      setIndex((i) => Math.max(0, i - 1));
      void inbox.refetch();
    } catch (e) {
      toast.error(`Не удалось вернуть: ${(e as Error).message}`);
    }
  }

  function addFolder() {
    const name = window.prompt("Название папки галереи на DeviantArt")?.trim();
    if (!name) return;
    setExtraFolders((f) => (f.includes(name) ? f : [...f, name]));
    setFolder(name);
  }


  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-semibold leading-tight">Отбор</h1>
            <p className="text-xs text-muted-foreground">
              Осталось {Math.max(0, items.length - index)} из {items.length}
            </p>
          </div>
          {last && (
            <Button variant="ghost" size="sm" onClick={undo}>
              <Undo2 className="mr-1 h-4 w-4" /> Вернуть
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {inbox.isLoading ? (
          <div className="grid h-64 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !current ? (
          <EmptyInbox count={items.length} />
        ) : (
          <>
            <CharacterPicker
              chars={chars.data ?? []}
              value={charId}
              onChange={setCharId}
            />
            <FolderPicker
              options={folderOptions}
              value={folder}
              defaultFolder={activeChar?.gallery_folder || null}
              onChange={setFolder}
              onAdd={addFolder}
            />
            <Card item={current} />

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button
                size="lg"
                variant="outline"
                className="h-16 text-base"
                onClick={() => act("rejected")}
              >
                <X className="mr-2 h-5 w-5" /> Мимо
              </Button>
              <Button size="lg" className="h-16 text-base" onClick={() => act("approved")}>
                <Check className="mr-2 h-5 w-5" /> Годится
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Одобренное уйдёт на апскейл и публикацию автоматически.
            </p>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function EmptyInbox({ count }: { count: number }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-border p-8 text-center">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 font-display text-lg font-semibold">
        {count > 0 ? "Всё разобрано" : "Пока нечего отбирать"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {count > 0
          ? "Новые кадры появятся, как только компьютер их сгенерирует."
          : "Запустите агента на компьютере — он сам пришлёт превью новых генераций."}
      </p>
      <Button asChild variant="outline" className="mt-5">
        <Link to="/setup">Настроить агента</Link>
      </Button>
    </div>
  );
}

function CharacterPicker({
  chars,
  value,
  onChange,
}: {
  chars: { id: string; name: string }[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  if (chars.length === 0) {
    return (
      <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Добавьте персонажа, чтобы название и теги подставлялись сами —{" "}
        <Link to="/characters" className="underline underline-offset-2">
          Персонажи
        </Link>
      </p>
    );
  }
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
      {chars.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
            value === c.id
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function FolderPicker({
  options,
  value,
  defaultFolder,
  onChange,
  onAdd,
}: {
  options: string[];
  value: string | null;
  defaultFolder: string | null;
  onChange: (v: string | null) => void;
  onAdd: () => void;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5" /> Папка на DeviantArt
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => onChange(null)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
            value === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          {defaultFolder ? `По умолчанию: ${defaultFolder}` : "По умолчанию"}
        </button>
        {options
          .filter((o) => o !== defaultFolder)
          .map((o) => (
            <button
              key={o}
              onClick={() => onChange(o)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
                value === o
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {o}
            </button>
          ))}
        <button
          onClick={onAdd}
          className="shrink-0 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          + Другая
        </button>
      </div>
    </div>
  );
}

function Card({ item }: { item: ImageRow }) {
  const { data: url } = useQuery({
    queryKey: ["preview", item.id],
    queryFn: () => signedPreview(item.preview_path),
  });
  const ratio = useMemo(
    () => (item.width && item.height ? item.width / item.height : 1),
    [item.width, item.height],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="grid place-items-center bg-black/40" style={{ aspectRatio: ratio }}>
        {url ? (
          <img src={url} alt={item.filename} className="h-full w-full object-contain" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium">{item.filename}</p>
        {item.width && item.height && (
          <p className="text-[11px] text-muted-foreground">
            {item.width}×{item.height}
          </p>
        )}
      </div>
    </div>
  );
}
