import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Tag as TagIcon, Loader2 } from "lucide-react";
import { getAllItems, type GalleryItem } from "@/lib/gallery-store";

export const Route = createFileRoute("/tags")({
  head: () => ({
    meta: [
      { title: "Tags — Local Image Vault" },
      { name: "description", content: "Browse every tag in your local image library." },
    ],
  }),
  component: TagsPage,
});

function TagsPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAllItems().then((d) => {
      setItems(d);
      setLoading(false);
    });
  }, []);

  const tags = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Tags</h1>
        <p className="text-sm text-muted-foreground">
          {tags.length} unique tag{tags.length === 1 ? "" : "s"} across {items.length} images
        </p>
      </div>

      {loading ? (
        <div className="grid place-items-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 p-12 text-center text-sm text-muted-foreground">
          No tags yet. Open an image from the Library and add some.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(([t, count]) => (
            <Link
              key={t}
              to="/"
              search={{ tags: t }}
              className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm text-secondary-foreground transition hover:bg-primary hover:text-primary-foreground"
            >
              <TagIcon className="h-3.5 w-3.5" />
              #{t}
              <span className="rounded-full bg-background/30 px-2 py-0.5 text-xs">{count}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
