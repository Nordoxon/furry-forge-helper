import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Star, ImageDown, Trash2, Plus, ChevronLeft, Crown, Download, Play, Pause } from "lucide-react";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomNav } from "@/components/bottom-nav";
import { fetchCharacters, signedPreview, type ImageRow } from "@/lib/images";
import {
  buildPack,
  fetchPacks,
  fetchPackImages,
  fetchSelection,
  packLabel,
  setKind,
  setPreviewFlag,
  setCoverFlag,
  packZipUrl,
  deletePackZip,
  deletePackPreview,
  deleteImages,
  nextPackNumber,
} from "@/lib/packs";
import { renderCover } from "@/lib/cover";
import { batchState, packItems } from "@/lib/batch";
import { pauseGeneration, startGeneration } from "@/lib/generation";

function GenerationControl({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (on: boolean) => void | Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {enabled ? "Генерация идёт" : "Генерация остановлена"}
          </p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Компьютер генерирует кадры для текущего этапа. Можно поставить на паузу в любой момент."
              : "Нажмите, чтобы начать новую сборку — компьютер продолжит с того же места."}
          </p>
        </div>
        <Button
          variant={enabled ? "outline" : "default"}
          onClick={() => void onToggle(!enabled)}
          className="shrink-0"
        >
          {enabled ? (
            <>
              <Pause className="mr-1 h-4 w-4" /> Пауза
            </>
          ) : (
            <>
              <Play className="mr-1 h-4 w-4" /> Начать
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

export const Route = createFileRoute("/_authenticated/packs")({
  validateSearch: (search: Record<string, unknown>) => ({
    character: typeof search["character"] === "string" ? (search["character"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Паки — Furry Content Manager" },
      {
        name: "description",
        content: "Соберите пак из отобранных изображений, отметьте превью и сделайте обложку с количеством картинок.",
      },
      { property: "og:title", content: "Паки — Furry Content Manager" },
      {
        property: "og:description",
        content: "Счётчик отобранного, сборка пака одной кнопкой и обложка с надписью для эксклюзива.",
      },
    ],
  }),
  component: PacksPage,
});

function PacksPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { character } = Route.useSearch();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState("");

  const chars = useQuery({ queryKey: ["characters"], queryFn: fetchCharacters });
  const charId = character ?? null;

  const selectChar = (id: string | null) =>
    navigate({ to: "/packs", search: { character: id ?? undefined }, replace: true });


  const selection = useQuery({
    queryKey: ["selection", charId],
    queryFn: () => fetchSelection(charId),
    refetchInterval: 20000,
    enabled: Boolean(charId),
  });
  const packs = useQuery({ queryKey: ["packs"], queryFn: fetchPacks });

  const activeChar = chars.data?.find((c) => c.id === charId) ?? null;


  useEffect(() => {
    let alive = true;
    void nextPackNumber(charId).then((n) => {
      if (alive) setNumber(String(n));
    });
    return () => {
      alive = false;
    };
  }, [charId, packs.data]);

  const autoTitle = activeChar ? `${activeChar.name} #${number || 1}` : "";

  const items = selection.data ?? [];
  const batch = batchState(activeChar, items);
  const sfw = batch.sfw;
  const nsfw = batch.nsfw;
  const previews = batch.previews;
  const packSet = packItems(batch);
  const packSfw = packSet.filter((i) => i.content_kind === "sfw").length;
  const caption = `${packSfw} SFW + ${packSet.length - packSfw} NSFW images`;
  const charPacks = (packs.data ?? []).filter((p) => p.character_id === charId);


  async function onBuild() {
    if (packSet.length === 0) return;
    setBusy(true);
    try {
      await buildPack(title.trim() || autoTitle, packSet, charId, Number(number) || null);
      setTitle("");
      toast.success("Пак собран");
      void qc.invalidateQueries({ queryKey: ["selection"] });
      void qc.invalidateQueries({ queryKey: ["packs"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!charId) {
    const list = chars.data ?? [];
    return (
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto max-w-2xl">
            <h1 className="font-display text-lg font-semibold leading-tight">Паки</h1>
            <p className="text-xs text-muted-foreground">Сначала выберите персонажа</p>
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-4 py-4">
          {chars.isLoading ? (
            <div className="grid h-40 place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : list.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-center">
              <h2 className="font-display text-lg font-semibold">Ни одного персонажа</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Паки нумеруются по персонажу — создайте его, чтобы собрать первый пак.
              </p>
              <Button className="mt-5" asChild>
                <Link to="/characters">
                  <Plus className="mr-1 h-4 w-4" /> Создать персонажа
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectChar(c.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {c.species || "Собрать пак этого персонажа"}
                    </p>
                  </div>
                  <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              <Button variant="outline" className="w-full" asChild>
                <Link to="/characters">
                  <Plus className="mr-1 h-4 w-4" /> Новый персонаж
                </Link>
              </Button>
            </>
          )}
        </main>

        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <button
            onClick={() => selectChar(null)}
            aria-label="Выбрать другого персонажа"
            className="rounded-full p-1 text-muted-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold leading-tight">
              {activeChar?.name ?? "Паки"}
            </h1>
            <p className="text-xs text-muted-foreground">Текущий отбор: {caption}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-4">

        {activeChar && (
          <GenerationControl
            enabled={activeChar.generation_enabled}
            onToggle={async (on) => {
              try {
                if (on) await startGeneration(activeChar.id);
                else await pauseGeneration(activeChar.id);
                toast.success(on ? "Генерация запущена" : "Генерация на паузе");
                void qc.invalidateQueries({ queryKey: ["characters"] });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          />
        )}




        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-3">
            <Counter label="SFW" value={sfw.length} />
            <Counter label="NSFW" value={nsfw.length} />
            <Counter label="Превью" value={previews.length} />
          </div>

          <div className="mt-4 space-y-2">
            <Input
              type="number"
              min={1}
              placeholder="Номер пака"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
            <Input
              placeholder={autoTitle || "Название пака (необязательно)"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {batch.phase === "sfw"
                ? `Ещё ${batch.sfwTarget - sfw.length} SFW до конца этапа`
                : batch.phase === "nsfw"
                  ? `Ещё ${batch.nsfwTarget - nsfw.length} NSFW до конца отбора`
                  : previews.length === 0
                    ? "Отметьте 3–4 превью среди SFW — звёздочкой на кадре"
                    : "Готово: можно собирать пак, апскейл начнётся сразу после сборки"}
            </p>
            <Button
              className="w-full"
              disabled={packSet.length === 0 || busy || previews.length === 0}
              onClick={onBuild}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
              Собрать пак ({packSet.length})
            </Button>
            <CoverButton items={previews.length ? previews : items} caption={caption} title={title} />
          </div>
        </section>

        {items.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Отобрано, ещё не в паке</h2>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={async () => {
                  if (!window.confirm(`Удалить ${items.length} изображений с сайта?`)) return;
                  await deleteImages(items.map((i) => i.id));
                  toast.success("Удалено");
                  void qc.invalidateQueries({ queryKey: ["selection"] });
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Очистить
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {items.map((i) => (
                <Thumb
                  key={i.id}
                  item={i}
                  onKind={async (k) => {
                    await setKind(i.id, k);
                    void qc.invalidateQueries({ queryKey: ["selection"] });
                  }}
                  onPreview={async (v) => {
                    await setPreviewFlag(i.id, v);
                    void qc.invalidateQueries({ queryKey: ["selection"] });
                  }}
                  onCover={async (v) => {
                    await setCoverFlag(i.id, charId ?? null, v);
                    void qc.invalidateQueries({ queryKey: ["selection"] });
                  }}
                  onDelete={async () => {
                    await deleteImages([i.id]);
                    void qc.invalidateQueries({ queryKey: ["selection"] });
                  }}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-medium">Собранные паки</h2>
          {charPacks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Здесь появятся собранные паки. Отбирайте кадры, отмечайте 3–4 из них как превью и жмите «Собрать пак».
            </p>
          ) : (
            <ul className="space-y-2">
              {charPacks.map((p) => (

                <li key={p.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.title || "Без названия"}
                        {p.pack_number ? <span className="ml-2 text-[11px] text-muted-foreground">#{p.pack_number}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {packLabel(p)} · {p.status === "zipped" ? "Архив готов" : "Апскейл и архив"}
                      </p>
                    </div>
                    {p.zip_path && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <ZipButton path={p.zip_path} packId={p.id} />
                      </div>
                    )}
                  </div>
                  {!p.zip_path && p.zip_url && (
                    <p className="mt-1 break-all text-[11px] text-muted-foreground">
                      Архив на компьютере: {p.zip_url}
                    </p>
                  )}
                  <div className="mt-2">
                    <PackCover packId={p.id} caption={packLabel(p)} title={p.title} />
                  </div>
                  <PackPreviews packId={p.id} paths={p.preview_paths ?? []} />
                </li>

              ))}
            </ul>
          )}
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl bg-muted px-3 py-2 text-center">
      <p className="font-display text-xl font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function useSigned(item: ImageRow) {
  return useQuery({
    queryKey: ["preview", item.id],
    queryFn: () => signedPreview(item.preview_path),
  });
}

function Thumb({
  item,
  onKind,
  onPreview,
  onCover,
  onDelete,
}: {
  item: ImageRow;
  onKind: (k: "sfw" | "nsfw") => void;
  onPreview: (v: boolean) => void;
  onCover: (v: boolean) => void;
  onDelete: () => void;
}) {
  const { data: url } = useSigned(item);
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="relative aspect-square bg-black/40">
        {url && <img src={url} alt={item.filename} className="h-full w-full object-cover" />}
        <button
          onClick={() => onPreview(!item.is_preview)}
          disabled={item.content_kind !== "sfw"}
          title={item.content_kind !== "sfw" ? "Превью выбирается из SFW" : "В превью"}
          aria-label="В превью"
          className={`absolute right-1 top-1 rounded-full p-1.5 ${
            item.is_preview
              ? "bg-primary text-primary-foreground"
              : item.content_kind !== "sfw"
                ? "hidden"
                : "bg-background/70 text-muted-foreground"
          }`}
        >
          <Star className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onCover(!item.is_cover)}
          title="Обложка для DeviantArt"
          aria-label="Обложка"
          className={`absolute bottom-1 right-1 rounded-full p-1.5 ${
            item.is_cover ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted-foreground"
          }`}
        >
          <Crown className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          aria-label="Удалить"
          className="absolute left-1 top-1 rounded-full bg-background/70 p-1.5 text-muted-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex">
        {(["sfw", "nsfw"] as const).map((k) => (
          <button
            key={k}
            onClick={() => onKind(k)}
            className={`flex-1 py-1.5 text-[11px] uppercase ${
              (item.content_kind === "sfw" ? "sfw" : "nsfw") === k
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

function CoverButton({
  items,
  caption,
  title,
}: {
  items: ImageRow[];
  caption: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useMemo(() => items.slice(0, 1), [items]);

  async function make() {
    if (ids.length === 0) {
      toast.error("Нет изображений для обложки");
      return;
    }
    setBusy(true);
    try {
      const urls = (await Promise.all(ids.map((i) => signedPreview(i.preview_path)))).filter(
        (u): u is string => Boolean(u),
      );
      const blob = await renderCover({ urls, caption, title: title || undefined });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "cover.png";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function makeFromFile(file: File) {
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const blob = await renderCover({ urls: [url], caption, title: title || undefined });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "cover.png";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" className="w-full" onClick={make} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}
        Сделать обложку
      </Button>
      <Button
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        <ImageDown className="mr-2 h-4 w-4" />
        Обложка из своего файла
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void makeFromFile(f);
        }}
      />
    </div>
  );
}

function ZipButton({ path, packId }: { path: string; packId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const url = await packZipUrl(path);
            if (!url) throw new Error("Архив ещё не залит с компьютера");
            window.open(url, "_blank");
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={removing}
        title="Удалить архив из облака"
        onClick={async () => {
          if (!window.confirm("Удалить архив из облака? Скачать его после этого будет нельзя.")) return;
          setRemoving(true);
          try {
            await deletePackZip(packId, path);
            toast.success("Архив удалён из облака");
            void qc.invalidateQueries({ queryKey: ["packs"] });
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setRemoving(false);
          }
        }}
      >
        {removing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4 text-destructive" />
        )}
      </Button>
    </>
  );
}

/** Превью пака рядом с архивом — их можно скачать на телефон. */
function PackPreviews({ packId, paths }: { packId: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <p className="mb-1.5 text-[11px] text-muted-foreground">Превью пака ({paths.length})</p>
      <div className="flex flex-wrap gap-2">
        {paths.map((path) => (
          <PreviewDownload key={path} packId={packId} path={path} paths={paths} />
        ))}
      </div>
    </div>
  );
}

function PreviewDownload({ packId, path, paths }: { packId: string; path: string; paths: string[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const name = path.split("/").pop() ?? "превью";
  return (
    <div className="flex max-w-full items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        className="max-w-[10rem]"
        onClick={async () => {
          setBusy(true);
          try {
            const url = await packZipUrl(path);
            if (!url) throw new Error("Файл ещё не залит с компьютера");
            window.open(url, "_blank");
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-1 h-4 w-4 shrink-0" />
        )}
        <span className="truncate text-xs">{name}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={removing}
        title="Удалить превью из облака"
        aria-label="Удалить превью из облака"
        onClick={async () => {
          if (!window.confirm("Удалить это превью из облака?")) return;
          setRemoving(true);
          try {
            await deletePackPreview(packId, path, paths);
            toast.success("Превью удалено");
            void qc.invalidateQueries({ queryKey: ["packs"] });
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setRemoving(false);
          }
        }}
      >
        {removing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4 text-destructive" />
        )}
      </Button>
    </div>
  );
}




function PackCover({ packId, caption, title }: { packId: string; caption: string; title: string }) {
  const { data } = useQuery({ queryKey: ["pack-images", packId], queryFn: () => fetchPackImages(packId) });
  const items = (data ?? [])
    .filter((i) => i.is_preview)
    .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  return <CoverButton items={items.length ? items : (data ?? [])} caption={caption} title={title} />;
}
