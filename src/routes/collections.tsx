import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, FolderHeart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  type Collection,
  type GalleryItem,
  createCollection,
  deleteCollection,
  getAllCollections,
  getAllItems,
  saveItem,
  deleteItem,
} from "@/lib/gallery-store";
import { useUrlCache, Thumb, type ItemWithUrl } from "@/components/gallery-shared";
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
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { ensureUrl, release } = useUrlCache();

  async function refresh() {
    const [cs, is] = await Promise.all([getAllCollections(), getAllItems()]);
    setCollections(cs);
    setItems(is);
    if (!activeId && cs.length) setActiveId(cs[0].id);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const c = await createCollection(name);
    setCollections((prev) => [c, ...prev]);
    setActiveId(c.id);
    setNewName("");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this collection? Images remain in the library.")) return;
    await deleteCollection(id);
    setCollections((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  const active = collections.find((c) => c.id === activeId) ?? null;
  const activeItems = useMemo<ItemWithUrl[]>(() => {
    if (!active) return [];
    const map = new Map(items.map((i) => [i.id, i]));
    return active.fileIds.map((id) => map.get(id)).filter(Boolean) as ItemWithUrl[];
  }, [active, items]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

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
    setCollections((prev) =>
      prev.map((c) => ({ ...c, fileIds: c.fileIds.filter((x) => x !== id) })),
    );
    if (selectedId === id) setSelectedId(null);
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
                  <Thumb key={item.id} item={item} ensureUrl={ensureUrl} onOpen={() => setSelectedId(item.id)} />
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
              onSave={(tags) => updateTags(selected.id, tags)}
              onRemove={() => removeItem(selected.id)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
