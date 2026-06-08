import { useEffect, useRef, useState } from "react";
import { Loader2, FolderHeart, Tag as TagIcon } from "lucide-react";
import { type FileItem, type Tag, getHandle, verifyPermission } from "@/lib/gallery-store";

export type ItemWithUrl = FileItem & { url?: string };

export function useUrlCache() {
  const urlCache = useRef<Map<string, string>>(new Map());
  useEffect(() => {
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
  function release(id: string) {
    const url = urlCache.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urlCache.current.delete(id);
  }
  return { ensureUrl, release };
}

export function Thumb({
  item,
  ensureUrl,
  tagsById,
  onOpen,
}: {
  item: ItemWithUrl;
  ensureUrl: (item: ItemWithUrl) => Promise<string | undefined>;
  tagsById: Map<string, Tag>;
  onOpen: () => void;
}) {
  const [url, setUrl] = useState<string | undefined>();
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    ensureUrl(item)
      .then((u) => alive && (u ? setUrl(u) : setErr(true)))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [item.id]);

  const tagNames = item.tagIds
    .map((id) => tagsById.get(id)?.name)
    .filter(Boolean) as string[];

  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left transition hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10"
    >
      <div className="relative aspect-square">
        {url ? (
          <img src={url} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-[1.03]" loading="lazy" />
        ) : err ? (
          <div className="grid h-full place-items-center px-2 text-center text-xs text-muted-foreground">
            Файл недоступен
          </div>
        ) : (
          <div className="grid h-full place-items-center bg-muted">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {item.collectionIds.length > 0 && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            <FolderHeart className="h-3 w-3" />
            {item.collectionIds.length}
          </span>
        )}
      </div>

      <div className="space-y-1 px-3 py-2">
        <p className="truncate text-sm font-medium">{item.name}</p>
        {tagNames.length > 0 ? (
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <TagIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{tagNames.map((n) => `#${n}`).join("  ")}</span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground/60">Без тегов</p>
        )}
      </div>
    </button>
  );
}
