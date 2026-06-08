import { useEffect, useState } from "react";
import { X, Tag as TagIcon, Trash2, Loader2, FolderHeart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  type Collection,
  type Tag,
  ensureTagByName,
  getAllCollections,
  getAllTags,
  toggleItemInCollection,
  assignTag,
  unassignTag,
} from "@/lib/gallery-store";
import type { ItemWithUrl } from "./gallery-shared";

export function DetailPanel({
  item,
  ensureUrl,
  onChange,
  onRemove,
}: {
  item: ItemWithUrl;
  ensureUrl: (item: ItemWithUrl) => Promise<string | undefined>;
  /** Called after any DB mutation that affects this item. */
  onChange: () => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    ensureUrl(item).then(setUrl);
  }, [item.id]);

  useEffect(() => {
    Promise.all([getAllCollections(), getAllTags()]).then(([cs, ts]) => {
      setCollections(cs);
      setTags(ts);
    });
  }, [item.id, item.tagIds.length, item.collectionIds.length]);

  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const itemTags = item.tagIds
    .map((id) => tagsById.get(id))
    .filter(Boolean) as Tag[];

  async function addTag(raw: string) {
    const names = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    for (const n of names) {
      try {
        const tag = await ensureTagByName(n);
        await assignTag(item.id, tag.id);
      } catch {
        // ignore empty after normalization
      }
    }
    setInput("");
    setTags(await getAllTags());
    onChange();
  }

  async function removeTag(tagId: string) {
    await unassignTag(item.id, tagId);
    onChange();
  }

  async function toggleCollection(c: Collection) {
    await toggleItemInCollection(c.id, item.id);
    setCollections(await getAllCollections());
    onChange();
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

      <div className="space-y-5 p-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <TagIcon className="h-3.5 w-3.5" /> Tags
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {itemTags.length === 0 && <span className="text-sm text-muted-foreground">No tags yet</span>}
            {itemTags.map((t) => (
              <Badge key={t.id} variant="secondary" className="gap-1 pr-1 text-xs">
                #{t.name}
                <button onClick={() => removeTag(t.id)} className="ml-1 rounded p-0.5 hover:bg-destructive/30">
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

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <FolderHeart className="h-3.5 w-3.5" /> Collections
          </div>
          {collections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No collections yet. Create one from the Collections tab.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {collections.map((c) => {
                const inside = item.collectionIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCollection(c)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition ${
                      inside
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-accent"
                    }`}
                  >
                    {inside && <Check className="h-3 w-3" />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
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
