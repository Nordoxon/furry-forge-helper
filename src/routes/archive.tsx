import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Trash2, Package, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type Release,
  deleteRelease,
  getAllReleases,
  STEP_LABELS,
} from "@/lib/pipeline-store";

export const Route = createFileRoute("/archive")({
  head: () => ({ meta: [{ title: "Архив релизов — Furry Content Manager" }] }),
  component: ArchivePage,
});

function ArchivePage() {
  const [rs, setRs] = useState<Release[]>([]);
  async function reload() {
    setRs(await getAllReleases());
  }
  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Архив</h1>
          <p className="mt-1 text-sm text-muted-foreground">Прошлые релизы и старая библиотека.</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/library"><Images /> Старая библиотека</Link>
        </Button>
      </div>

      {rs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-2 h-6 w-6" />
          Релизов пока нет
        </div>
      ) : (
        <ul className="space-y-2">
          {rs.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{r.title || r.packName}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()} · {r.starredIds.length} избр. ·{" "}
                  {STEP_LABELS[r.step]}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  if (confirm("Удалить релиз?")) {
                    await deleteRelease(r.id);
                    reload();
                  }
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
