import { useEffect, useState } from "react";
import { X, Tag as TagIcon, Trash2, Loader2, FolderHeart, Check, Pencil, Plus } from "lucide-react";
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
  renameFile,
  createCollection,
  addFileToCollection,
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
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [newCollection, setNewCollection] = useState("");

  useEffect(() => {
    ensureUrl(item).then(setUrl);
  }, [item.id]);

  useEffect(() => {
    setNameDraft(item.name);
    setEditingName(false);
  }, [item.id, item.name]);

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
        /* skip empty */
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

  async function commitName() {
    if (nameDraft.trim() && nameDraft !== item.name) {
      await renameFile(item.id, nameDraft);
      onChange();
    }
    setEditingName(false);
  }

  async function quickCreateCollection() {
    const name = newCollection.trim();
    if (!name) return;
    const c = await createCollection(name);
    await addFileToCollection(c.id, item.id);
    setNewCollection("");
    setCollections(await getAllCollections());
    onChange();
  }

  return (
    <div className="flex flex-col">
      <SheetHeader className="border-b border-border/60 p-6">
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  setNameDraft(item.name);
                  setEditingName(false);
                }
              }}
            />
            <Button size="icon" variant="ghost" onClick={commitName}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="group flex items-center gap-2 text-left"
            title="Переименовать"
          >
            <SheetTitle className="truncate pr-2">{item.name}</SheetTitle>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
          </button>
        )}
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

      <div className="space-y-6 p-6">
        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <TagIcon className="h-3.5 w-3.5" /> Теги
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {itemTags.length === 0 && (
              <span className="text-sm text-muted-foreground">Нет тегов. Добавьте первый ↓</span>
            )}
            {itemTags.map((t) => (
              <Badge key={t.id} variant="secondary" className="gap-1 pr-1 text-xs">
                #{t.name}
                <button
                  onClick={() => removeTag(t.id)}
                  className="ml-1 rounded p-0.5 hover:bg-destructive/30"
                  title="Убрать тег"
                >
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
              placeholder="Например: персонаж, портрет"
            />
            <Button onClick={() => addTag(input)} disabled={!input.trim()}>
              <Plus /> Добавить
            </Button>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <FolderHeart className="h-3.5 w-3.5" /> Коллекции
          </div>
          {collections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока нет коллекций. Создайте первую ↓
            </p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-1.5">
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
                    title={inside ? "Убрать из коллекции" : "Добавить в коллекцию"}
                  >
                    {inside ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && quickCreateCollection()}
              placeholder="Новая коллекция…"
            />
            <Button
              variant="outline"
              onClick={quickCreateCollection}
              disabled={!newCollection.trim()}
            >
              <Plus /> Создать
            </Button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <div>
            <div className="uppercase tracking-wider">Размер</div>
            <div className="text-foreground">{(item.size / 1024).toFixed(1)} КБ</div>
          </div>
          <div>
            <div className="uppercase tracking-wider">Тип</div>
            <div className="text-foreground">{item.type}</div>
          </div>
        </section>

        <Button variant="destructive" className="w-full" onClick={onRemove}>
          <Trash2 /> Убрать из библиотеки
        </Button>
      </div>
    </div>
  );
}
