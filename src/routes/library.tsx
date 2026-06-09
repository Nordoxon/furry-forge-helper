import { useEffect, useMemo, useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, FolderPlus, Trash2, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  type FileItem,
  type Tag,
  saveItem,
  saveHandle,
  getAllItems,
  getAllTags,
  deleteItem,
  clearAll,
} from "@/lib/gallery-store";
import { useUrlCache, Thumb } from "@/components/gallery-shared";
import { DetailPanel } from "@/components/detail-panel";

type SearchParams = { tags?: string };

export const Route = createFileRoute("/library")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    tags: typeof s.tags === "string" ? s.tags : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Library — Local Image Vault" },
      { name: "description", content: "Private offline gallery. Import folders, tag photos, search — all stored locally in your browser." },
    ],
  }),
  component: Index,
});

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;

function Index() {
  const navigate = useNavigate({ from: "/library" });
  const { tags: tagsParam } = Route.useSearch();
  const selectedTagIds = useMemo<string[]>(
    () => (tagsParam ? tagsParam.split(",").filter(Boolean) : []),
    [tagsParam],
  );

  const [items, setItems] = useState<FileItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const { ensureUrl, release } = useUrlCache();

  const refresh = useCallback(async () => {
    const [is, ts] = await Promise.all([getAllItems(), getAllTags()]);
    setItems(is);
    setTags(ts);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  function setSelectedTagIds(next: string[]) {
    navigate({
      search: { tags: next.length ? next.join(",") : undefined },
      replace: true,
    });
  }

  function toggleTag(id: string) {
    setSelectedTagIds(
      selectedTagIds.includes(id) ? selectedTagIds.filter((x) => x !== id) : [...selectedTagIds, id],
    );
  }

  async function importFolder() {
    if (!("showDirectoryPicker" in window)) {
      alert("Your browser doesn't support folder import. Try Chrome, Edge, or Opera on desktop.");
      return;
    }
    setImporting(true);
    try {
      // @ts-expect-error - File System Access API
      const dir: FileSystemDirectoryHandle = await window.showDirectoryPicker();
      let count = 0;
      await walkDir(dir, "", async (path, handle) => {
        if (!IMAGE_EXT.test(handle.name)) return;
        const file = await handle.getFile();
        const id = `${path}/${handle.name}::${file.size}::${file.lastModified}`;
        const item: FileItem = {
          id,
          name: handle.name,
          path: `${dir.name}${path}`,
          type: file.type || "image/*",
          size: file.size,
          addedAt: Date.now(),
          tagIds: [],
          collectionIds: [],
        };
        await saveHandle(id, handle);
        await saveItem(item);
        count++;
      });
      await refresh();
      console.log(`Imported ${count} images`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error(e);
    } finally {
      setImporting(false);
    }
  }

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.tagIds.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1)));
    return m;
  }, [items]);

  const visibleTags = useMemo(
    () => tags.filter((t) => (tagCounts.get(t.id) ?? 0) > 0).sort((a, b) => (tagCounts.get(b.id) ?? 0) - (tagCounts.get(a.id) ?? 0)),
    [tags, tagCounts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (selectedTagIds.length && !selectedTagIds.every((id) => i.tagIds.includes(id))) return false;
      if (!q) return true;
      if (i.name.toLowerCase().includes(q)) return true;
      return i.tagIds.some((id) => tagsById.get(id)?.name.includes(q));
    });
  }, [items, query, selectedTagIds, tagsById]);

  async function removeItem(id: string) {
    await deleteItem(id);
    release(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  async function handleClearAll() {
    if (!confirm("Remove all imported images, tags, and collections? Your original files stay on disk.")) return;
    await clearAll();
    await refresh();
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div>
      <header className="border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold leading-none">Библиотека</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {items.length === 0
                ? "Все изображения в одном месте"
                : `${items.length} ${pluralImages(items.length)}`}
            </p>
          </div>

          <div className="relative ml-auto w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени или тегу…"
              className="pl-9"
            />
          </div>

          <Button onClick={importFolder} disabled={importing}>
            {importing ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            Импорт папки
          </Button>
          {items.length > 0 && (
            <Button variant="ghost" size="icon" onClick={handleClearAll} title="Очистить всё">
              <Trash2 />
            </Button>
          )}
        </div>

        {visibleTags.length > 0 && (
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-6 pb-3">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Фильтр:</span>
            <button
              onClick={() => setSelectedTagIds([])}
              className={`rounded-full px-3 py-1 text-xs transition ${
                selectedTagIds.length === 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              Все · {items.length}
            </button>
            {visibleTags.map((t) => {
              const on = selectedTagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTag(t.id)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-accent"
                  }`}
                >
                  #{t.name} · {tagCounts.get(t.id) ?? 0}
                </button>
              );
            })}
            {selectedTagIds.length > 0 && (
              <button
                onClick={() => setSelectedTagIds([])}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> сбросить
              </button>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-8">
        {loading ? (
          <div className="grid place-items-center py-24 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasItems={items.length > 0} onImport={importFolder} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((item) => (
              <Thumb
                key={item.id}
                item={item}
                ensureUrl={ensureUrl}
                tagsById={tagsById}
                onOpen={() => setSelectedId(item.id)}
              />
            ))}
          </div>
        )}
      </main>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
          {selected && (
            <DetailPanel
              key={selected.id}
              item={selected}
              ensureUrl={ensureUrl}
              onChange={refresh}
              onRemove={() => removeItem(selected.id)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EmptyState({ hasItems, onImport }: { hasItems: boolean; onImport: () => void }) {
  return (
    <div className="mx-auto mt-24 max-w-md rounded-2xl border border-dashed border-border/80 bg-card/50 p-12 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <ImageIcon className="h-7 w-7" />
      </div>
      <h2 className="text-xl font-semibold">
        {hasItems ? "Ничего не найдено" : "Здесь будут ваши изображения"}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {hasItems
          ? "Попробуйте сбросить поиск или фильтр тегов."
          : "Добавьте папку с изображениями, чтобы начать. Файлы остаются у вас на диске — ничего не загружается в сеть."}
      </p>
      {!hasItems && (
        <Button className="mt-6" onClick={onImport}>
          <FolderPlus /> Импорт папки
        </Button>
      )}
    </div>
  );
}

function pluralImages(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "изображение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "изображения";
  return "изображений";
}

async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  visit: (path: string, file: FileSystemFileHandle) => Promise<void>,
) {
  const d = dir as unknown as { values: () => AsyncIterable<FileSystemHandle> };
  for await (const entry of d.values()) {
    if (entry.kind === "file") await visit(prefix, entry as FileSystemFileHandle);
    else if (entry.kind === "directory") await walkDir(entry as FileSystemDirectoryHandle, `${prefix}/${entry.name}`, visit);
  }
}
