import { useEffect, useMemo, useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Tag as TagIcon, Loader2, Trash2, Pencil, Check, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getAllItems,
  getAllTags,
  createTag,
  deleteTag,
  renameTag,
  type FileItem,
  type Tag,
} from "@/lib/gallery-store";

export const Route = createFileRoute("/tags")({
  head: () => ({
    meta: [
      { title: "Tags — Local Image Vault" },
      { name: "description", content: "Browse, rename, and delete every tag in your local image library." },
    ],
  }),
  component: TagsPage,
});

function TagsPage() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newTag, setNewTag] = useState("");

  const refresh = useCallback(async () => {
    const [is, ts] = await Promise.all([getAllItems(), getAllTags()]);
    setItems(is);
    setTags(ts);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.tagIds.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1)));
    return m;
  }, [items]);

  const sorted = useMemo(
    () =>
      [...tags].sort(
        (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
      ),
    [tags, counts],
  );

  async function handleCreate() {
    const name = newTag.trim();
    if (!name) return;
    await createTag(name);
    setNewTag("");
    await refresh();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete tag "${name}"? It will be removed from every image.`)) return;
    await deleteTag(id);
    await refresh();
  }

  async function commitRename(id: string) {
    if (!draft.trim()) {
      setEditingId(null);
      return;
    }
    await renameTag(id, draft);
    setEditingId(null);
    setDraft("");
    await refresh();
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tags</h1>
          <p className="text-sm text-muted-foreground">
            {tags.length} tag{tags.length === 1 ? "" : "s"} across {items.length} images
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New tag name"
            className="w-56"
          />
          <Button onClick={handleCreate} disabled={!newTag.trim()}>
            <Plus /> Create
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 p-12 text-center text-sm text-muted-foreground">
          No tags yet. Create one above, or open an image and add tags inline.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((t) => {
            const count = counts.get(t.id) ?? 0;
            const editing = editingId === t.id;
            return (
              <li
                key={t.id}
                className="group flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2"
              >
                <TagIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                {editing ? (
                  <>
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(t.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-7"
                    />
                    <Button size="icon" variant="ghost" onClick={() => commitRename(t.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/"
                      search={{ tags: t.id }}
                      className="min-w-0 flex-1 truncate text-sm hover:text-primary"
                    >
                      #{t.name}
                    </Link>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {count}
                    </span>
                    <button
                      onClick={() => {
                        setEditingId(t.id);
                        setDraft(t.name);
                      }}
                      className="opacity-0 transition group-hover:opacity-70 hover:opacity-100"
                      title="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id, t.name)}
                      className="opacity-0 transition group-hover:opacity-70 hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
