import { useEffect, useMemo, useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, FolderHeart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  type Collection,
  type FileItem,
  type Tag,
  createCollection,
  deleteCollection,
  getAllCollections,
  getAllItems,
  getAllTags,
  deleteItem,
} from "@/lib/gallery-store";
import { useUrlCache, Thumb } from "@/components/gallery-shared";
import { DetailPanel } from "@/components/detail-panel";

export const Route = createFileRoute("/collections")({
  head: () => ({
    meta: [
      { title: "Collections — Local Image Vault" },
      { name: "description", content: "Group your locally stored images into private collections." },
    ],
  }),
  component: CollectionsPage,
});

function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [items, setItems] = useState<FileItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { ensureUrl, release } = useUrlCache();

  const refresh = useCallback(async () => {
    const [cs, is, ts] = await Promise.all([getAllCollections(), getAllItems(), getAllTags()]);
    setCollections(cs);
    setItems(is);
    setTags(ts);
    setActiveId((prev) => prev ?? cs[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const c = await createCollection(name);
    setNewName("");
    setActiveId(c.id);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this collection? Images remain in the library.")) return;
    await deleteCollection(id);
    if (activeId === id) setActiveId(null);
    await refresh();
  }

  const active = collections.find((c) => c.id === activeId) ?? null;
  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const activeItems = useMemo<FileItem[]>(() => {
    if (!active) return [];
    const map = new Map(items.map((i) => [i.id, i]));
    return active.fileIds.map((id) => map.get(id)).filter(Boolean) as FileItem[];
  }, [active, items]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function removeItem(id: string) {
    await deleteItem(id);
    release(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1600px] gap-6 px-6 py-8">
      <aside className="w-72 shrink-0 space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New collection name"
          />
          <Button size="icon" onClick={handleCreate} disabled={!newName.trim()}>
            <Plus />
          </Button>
        </div>

        {collections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
            No collections yet. Create one above.
          </p>
        ) : (
          <ul className="space-y-1">
            {collections.map((c) => (
              <li key={c.id}>
                <div
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    activeId === c.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-card hover:bg-accent"
                  }`}
                >
                  <button onClick={() => setActiveId(c.id)} className="flex flex-1 items-center gap-2 truncate text-left">
                    <FolderHeart className="h-4 w-4 shrink-0" />
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto text-xs opacity-70">{c.fileIds.length}</span>
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="opacity-0 transition group-hover:opacity-70 hover:opacity-100"
                    title="Delete collection"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0 flex-1">
        {!active ? (
          <div className="grid h-full place-items-center text-muted-foreground">
            Select or create a collection.
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold">{active.name}</h1>
              <p className="text-sm text-muted-foreground">{active.fileIds.length} images</p>
            </div>
            {activeItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 p-12 text-center text-sm text-muted-foreground">
                This collection is empty. Open any image from the Library and toggle this collection.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {activeItems.map((item) => (
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
          </>
        )}
      </section>

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
