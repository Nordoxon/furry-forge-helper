import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, FolderPlus, X, Trash2, Tag as TagIcon, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  type GalleryItem,
  saveItem,
  saveHandle,
  getHandle,
  getAllItems,
  deleteItem,
  clearAll,
  verifyPermission,
} from "@/lib/gallery-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Local Image Vault — Offline Gallery" },
      { name: "description", content: "Private offline gallery. Import folders, tag photos, search — all stored locally in your browser." },
    ],
  }),
  component: Index,
});

type ItemWithUrl = GalleryItem & { url?: string };

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;

function Index() {
  const [items, setItems] = useState<ItemWithUrl[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const urlCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      const data = await getAllItems();
      setItems(data);
      setLoading(false);
    })();
    return () => {
      urlCache.current.forEach((u) => URL.revokeObjectURL(u));
      urlCache.current.clear();
    };
  }, []);

  async function ensureUrl(item: ItemWithUrl): Promise<string | undefined> {
    if (urlCache.current.has(item.id)) return urlCache.current.get(item.id);
    const handle = await getHandle(item.id);
    if (!handle) return;
    if (!(await verifyPermission(handle))) return;
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    urlCache.current.set(item.id, url);
    return url;
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
      if (activeTag && !i.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, activeTag]);

  async function updateTags(id: string, tags: string[]) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const next = { ...item, tags };
    await saveItem(next);
    setItems((prev) => prev.map((i) => (i.id === id ? next : i)));
  }

  async function removeItem(id: string) {
    await deleteItem(id);
    const url = urlCache.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urlCache.current.delete(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function handleClearAll() {
    if (!confirm("Remove all imported images from the gallery? Your original files stay on disk.")) return;
    await clearAll();
    urlCache.current.forEach((u) => URL.revokeObjectURL(u));
    urlCache.current.clear();
    setItems([]);
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">Vault</h1>
              <p className="text-xs text-muted-foreground">local · offline · private</p>
            </div>
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
          <div className="mx-auto flex max-w-[1600px] flex-wrap gap-2 px-6 pb-3">
            <button
              onClick={() => setActiveTag(null)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                activeTag === null ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              All · {items.length}
            </button>
            {allTags.map(([t, count]) => (
              <button
                key={t}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  activeTag === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"
                }`}
              >
                #{t} · {count}
              </button>
            ))}
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

function Thumb({
  item,
  ensureUrl,
  onOpen,
}: {
  item: ItemWithUrl;
  ensureUrl: (item: ItemWithUrl) => Promise<string | undefined>;
  onOpen: () => void;
}) {
  const [url, setUrl] = useState<string | undefined>();
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    ensureUrl(item).then((u) => alive && (u ? setUrl(u) : setErr(true))).catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [item.id]);

  return (
    <button
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-xl border border-border/60 bg-card text-left transition hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10"
    >
      {url ? (
        <img src={url} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
      ) : err ? (
        <div className="grid h-full place-items-center px-2 text-center text-xs text-muted-foreground">
          File unavailable
        </div>
      ) : (
        <div className="grid h-full place-items-center bg-muted">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
        <p className="truncate text-xs font-medium text-white">{item.name}</p>
        {item.tags.length > 0 && (
          <p className="truncate text-[10px] text-white/70">{item.tags.map((t) => `#${t}`).join(" ")}</p>
        )}
      </div>
    </button>
  );
}

function DetailPanel({
  item,
  ensureUrl,
  onSave,
  onRemove,
}: {
  item: ItemWithUrl;
  ensureUrl: (item: ItemWithUrl) => Promise<string | undefined>;
  onSave: (tags: string[]) => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | undefined>();
  const [tags, setTags] = useState<string[]>(item.tags);
  const [input, setInput] = useState("");

  useEffect(() => {
    ensureUrl(item).then(setUrl);
  }, [item.id]);

  useEffect(() => {
    setTags(item.tags);
  }, [item.id]);

  function addTag(raw: string) {
    const next = raw
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
      .filter(Boolean)
      .filter((t) => !tags.includes(t));
    if (next.length === 0) return;
    const updated = [...tags, ...next];
    setTags(updated);
    onSave(updated);
    setInput("");
  }

  function removeTag(t: string) {
    const updated = tags.filter((x) => x !== t);
    setTags(updated);
    onSave(updated);
  }

  return (
    <div className="flex flex-col">
      <SheetHeader className="border-b border-border/60 p-6">
        <SheetTitle className="truncate pr-8">{item.name}</SheetTitle>
        <p className="truncate text-xs text-muted-foreground">{item.path}</p>
      </SheetHeader>

      <div className="bg-black/30 p-4">
        {url ? (
          <img src={url} alt={item.name} className="mx-auto max-h-[60vh] w-auto rounded-lg object-contain" />
        ) : (
          <div className="grid h-64 place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>

      <div className="space-y-4 p-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <TagIcon className="h-3.5 w-3.5" /> Tags
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {tags.length === 0 && <span className="text-sm text-muted-foreground">No tags yet</span>}
            {tags.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1 pr-1 text-xs">
                #{t}
                <button onClick={() => removeTag(t)} className="ml-1 rounded p-0.5 hover:bg-destructive/30">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(input);
                }
              }}
              placeholder="Add tag, press Enter (or comma-separate)"
            />
            <Button onClick={() => addTag(input)} disabled={!input.trim()}>
              Add
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <div className="uppercase tracking-wider">Size</div>
            <div className="text-foreground">{(item.size / 1024).toFixed(1)} KB</div>
          </div>
          <div>
            <div className="uppercase tracking-wider">Type</div>
            <div className="text-foreground">{item.type}</div>
          </div>
        </div>

        <Button variant="destructive" className="w-full" onClick={onRemove}>
          <Trash2 /> Remove from gallery
        </Button>
      </div>
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
          ? "Try clearing the search or selected tag."
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
