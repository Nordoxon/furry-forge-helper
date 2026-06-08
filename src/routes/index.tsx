import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, FolderPlus, Trash2, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  type GalleryItem,
  saveItem,
  saveHandle,
  getAllItems,
  deleteItem,
  clearAll,
} from "@/lib/gallery-store";
import { useUrlCache, Thumb, type ItemWithUrl } from "@/components/gallery-shared";
import { DetailPanel } from "@/components/detail-panel";

type Search = { tags?: string };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
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
  const navigate = useNavigate({ from: "/" });
  const { tags: tagsParam } = Route.useSearch();
  const selectedTags = useMemo<string[]>(
    () => (tagsParam ? tagsParam.split(",").filter(Boolean) : []),
    [tagsParam],
  );

  const [items, setItems] = useState<ItemWithUrl[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const { ensureUrl, release } = useUrlCache();

  useEffect(() => {
    (async () => {
      const data = await getAllItems();
      setItems(data);
      setLoading(false);
    })();
  }, []);

  function setSelectedTags(next: string[]) {
    navigate({
      search: { tags: next.length ? next.join(",") : undefined },
      replace: true,
    });
  }

  function toggleTag(t: string) {
    setSelectedTags(
      selectedTags.includes(t) ? selectedTags.filter((x) => x !== t) : [...selectedTags, t],
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
      const collected: GalleryItem[] = [];
      await walkDir(dir, "", async (path, handle) => {
        if (!IMAGE_EXT.test(handle.name)) return;
        const file = await handle.getFile();
        const id = `${path}/${handle.name}::${file.size}::${file.lastModified}`;
        const item: GalleryItem = {
          id,
          name: handle.name,
          path: `${dir.name}${path}`,
          tags: [],
          size: file.size,
          type: file.type || "image/*",
          addedAt: Date.now(),
        };
        await saveHandle(id, handle);
        await saveItem(item);
        collected.push(item);
      });
      const all = await getAllItems();
      setItems(all);
      console.log(`Imported ${collected.length} images`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error(e);
    } finally {
      setImporting(false);
    }
  }

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (selectedTags.length && !selectedTags.every((t) => i.tags.includes(t))) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, selectedTags]);

  async function updateTags(id: string, tags: string[]) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const next = { ...item, tags };
    await saveItem(next);
    setItems((prev) => prev.map((i) => (i.id === id ? next : i)));
  }

  async function removeItem(id: string) {
    await deleteItem(id);
    release(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function handleClearAll() {
    if (!confirm("Remove all imported images from the gallery? Your original files stay on disk.")) return;
    await clearAll();
    setItems([]);
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div>
      <header className="border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold leading-none">Library</h1>
            <p className="text-xs text-muted-foreground">{items.length} images</p>
          </div>

          <div className="relative ml-auto w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or tag…"
              className="pl-9"
            />
          </div>

          <Button onClick={importFolder} disabled={importing}>
            {importing ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            Import folder
          </Button>
          {items.length > 0 && (
            <Button variant="ghost" size="icon" onClick={handleClearAll} title="Clear gallery">
              <Trash2 />
            </Button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-6 pb-3">
            <button
              onClick={() => setSelectedTags([])}
              className={`rounded-full px-3 py-1 text-xs transition ${
                selectedTags.length === 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              All · {items.length}
            </button>
            {allTags.map(([t, count]) => {
              const on = selectedTags.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-accent"
                  }`}
                >
                  #{t} · {count}
                </button>
              );
            })}
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> clear
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
              <Thumb key={item.id} item={item} ensureUrl={ensureUrl} onOpen={() => setSelectedId(item.id)} />
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
              onSave={(tags) => updateTags(selected.id, tags)}
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
        {hasItems ? "Nothing matches" : "Your private gallery"}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {hasItems
          ? "Try clearing the search or selected tags."
          : "Import a folder of images. Everything stays in your browser — no upload, no account."}
      </p>
      {!hasItems && (
        <Button className="mt-6" onClick={onImport}>
          <FolderPlus /> Choose folder
        </Button>
      )}
    </div>
  );
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
