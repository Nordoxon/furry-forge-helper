import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
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
        {tagNames.length > 0 && (
          <p className="truncate text-[10px] text-white/70">{tagNames.map((n) => `#${n}`).join(" ")}</p>
        )}
      </div>
    </button>
  );
}
