import { useEffect, useState } from "react";
import { X, Tag as TagIcon, Trash2, Loader2, FolderHeart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  type Collection,
  getAllCollections,
  toggleItemInCollection,
} from "@/lib/gallery-store";
import type { ItemWithUrl } from "./gallery-shared";

export function DetailPanel({
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
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    ensureUrl(item).then(setUrl);
  }, [item.id]);

  useEffect(() => {
    setTags(item.tags);
  }, [item.id]);

  useEffect(() => {
    getAllCollections().then(setCollections);
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

  async function toggleCollection(c: Collection) {
    const updated = await toggleItemInCollection(c.id, item.id);
    if (updated) setCollections((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
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
                const inside = c.fileIds.includes(item.id);
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
