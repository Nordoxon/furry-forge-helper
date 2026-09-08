import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Inbox, Undo2, Trash2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BottomNav } from "@/components/bottom-nav";
import {
  decide,
  fetchCharacters,
  fetchInbox,
  signedPreview,
  type ImageRow,
} from "@/lib/images";
import { clearInbox, fetchSelection } from "@/lib/packs";
import { batchState, resetBatch, type BatchState } from "@/lib/batch";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Отбор изображений — Furry Content Manager" },
      {
        name: "description",
        content: "Быстрый отбор свежих генераций с телефона: одобряйте кадры, остальное сделает агент на компьютере.",
      },
      { property: "og:title", content: "Отбор изображений — Furry Content Manager" },
      {
        property: "og:description",
        content: "Одобряйте генерации в один тап — апскейл и публикация запускаются автоматически.",
      },
    ],
  }),
  component: TriagePage,
});

function TriagePage() {
  const qc = useQueryClient();
  const [done, setDone] = useState<string[]>([]);
  const [charId, setCharId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [last, setLast] = useState<{ id: string } | null>(null);
  const [kindOverride, setKindOverride] = useState<"sfw" | "nsfw" | null>(null);

  const inbox = useQuery({ queryKey: ["inbox"], queryFn: fetchInbox, refetchInterval: 20000 });
  const chars = useQuery({ queryKey: ["characters"], queryFn: fetchCharacters });
  const templates = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });

  useEffect(() => {
    if (charId === null && chars.data?.length) {
      setCharId((chars.data.find((c) => c.is_default) ?? chars.data[0]).id);
    }
  }, [chars.data, charId]);

  useEffect(() => {
    if (templateId === null && templates.data?.length) {
      const def = templates.data.find((t) => t.is_default);
      if (def) setTemplateId(def.id);
    }
  }, [templates.data, templateId]);

  const activeChar = useMemo(
    () => chars.data?.find((c) => c.id === charId) ?? null,
    [chars.data, charId],
  );

  const selection = useQuery({
    queryKey: ["selection", charId],
    queryFn: () => fetchSelection(charId),
    enabled: Boolean(charId),
  });

  const batch = useMemo(
    () => batchState(activeChar, selection.data ?? []),
    [activeChar, selection.data],
  );

  // при смене персонажа ручной выбор типа сбрасывается
  useEffect(() => setKindOverride(null), [charId]);

  const activeTemplate = useMemo(
    () => templates.data?.find((t) => t.id === templateId) ?? null,
    [templates.data, templateId],
  );

  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of chars.data ?? []) if (c.gallery_folder) set.add(c.gallery_folder);
    for (const t of templates.data ?? []) if (t.gallery_folder) set.add(t.gallery_folder);
    for (const f of extraFolders) set.add(f);
    return Array.from(set);
  }, [chars.data, templates.data, extraFolders]);

  const all = inbox.data ?? [];
  const doneSet = useMemo(() => new Set(done), [done]);
  // очередь стабильна: текущий кадр определяется по ID, а не по позиции в списке
  const items = useMemo(() => all.filter((i) => !doneSet.has(i.id)), [all, doneSet]);
  const current = items[0];
  const kind = kindOverride ?? batch.activeKind;

  async function act(status: "approved" | "rejected") {
    if (!current) return;
    if (status === "approved") {
      const limit = kind === "sfw" ? batch.sfwTarget : batch.nsfwTarget;
      const picked = kind === "sfw" ? batch.sfw.length : batch.nsfw.length;
      if (picked >= limit) {
        toast.error(`${kind === "sfw" ? "SFW" : "NSFW"} уже набрано ${limit} — этап закрыт`);
        return;
      }
    }
    const id = current.id;
    try {
      await decide(
        id,
        status,
        charId,
        status === "approved" ? folder : null,
        status === "approved" ? templateId : null,
        { contentKind: kind, isPreview: false },
      );
      setDone((d) => (d.includes(id) ? d : [...d, id]));
      setLast({ id });
      setKindOverride(null);
      void qc.invalidateQueries({ queryKey: ["selection"] });
      void qc.invalidateQueries({ queryKey: ["pipeline"] });
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    }
  }

  async function undo() {
    if (!last) return;
    try {
      await decide(last.id, "new", null, null);
      setDone((d) => d.filter((x) => x !== last.id));
      setLast(null);
      void inbox.refetch();
      void qc.invalidateQueries({ queryKey: ["selection"] });
    } catch (e) {
      toast.error(`Не удалось вернуть: ${(e as Error).message}`);
    }
  }

  function addFolder() {
    const name = window.prompt("Название папки галереи на DeviantArt")?.trim();
    if (!name) return;
    setExtraFolders((f) => (f.includes(name) ? f : [...f, name]));
    setFolder(name);
  }

  async function onClearInbox() {
    if (!window.confirm(`Удалить ${all.length} неразобранных кадров? Отобранное и паки останутся.`)) return;
    try {
      const n = await clearInbox();
      setDone([]);
      setLast(null);
      toast.success(`Удалено: ${n}`);
      void inbox.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onResetBatch() {
    if (!charId || !activeChar) return;
    if (
      !window.confirm(
        `Сбросить текущий отбор персонажа ${activeChar.name} (${batch.total} кадров)? Уже собранные паки останутся.`,
      )
    )
      return;
    try {
      const n = await resetBatch(charId);
      toast.success(`Отбор сброшен: ${n}`);
      void qc.invalidateQueries({ queryKey: ["selection"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold leading-tight">
              {activeChar ? activeChar.name : "Отбор"}
            </h1>
            <p className="text-xs text-muted-foreground">
              Осталось {items.length} из {all.length}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {last && (
              <Button variant="ghost" size="sm" onClick={undo}>
                <Undo2 className="mr-1 h-4 w-4" /> Вернуть
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="mr-1 h-4 w-4" /> Очистить
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={all.length === 0} onSelect={() => void onClearInbox()}>
                  Неразобранные кадры ({all.length})
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!charId || batch.total === 0}
                  onSelect={() => void onResetBatch()}
                >
                  Отбор персонажа ({batch.total})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {chars.isLoading ? (
          <div className="grid h-64 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (chars.data ?? []).length === 0 ? (
          <NoCharacter />
        ) : (
          <>
            <CharacterPicker chars={chars.data ?? []} value={charId} onChange={setCharId} />
            <BatchProgress batch={batch} />

            {batch.done ? (
              <PackReady charId={charId} />
            ) : inbox.isLoading ? (
              <div className="grid h-64 place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !current ? (
              <EmptyInbox count={all.length} />
            ) : (
              <>
                <TemplatePicker
                  templates={templates.data ?? []}
                  value={templateId}
                  onChange={setTemplateId}
                />
                <FolderPicker
                  options={folderOptions}
                  value={folder}
                  defaultFolder={activeTemplate?.gallery_folder || activeChar?.gallery_folder || null}
                  onChange={setFolder}
                  onAdd={addFolder}
                />
                <KindPicker kind={kind} auto={batch.activeKind} onKind={setKindOverride} />
                <Card item={current} />

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-16 text-base"
                    onClick={() => act("rejected")}
                  >
                    <X className="mr-2 h-5 w-5" /> Мимо
                  </Button>
                  <Button size="lg" className="h-16 text-base" onClick={() => act("approved")}>
                    <Check className="mr-2 h-5 w-5" /> Годится ({kind.toUpperCase()})
                  </Button>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Апскейл и архив запускаются только после того, как пак будет собран.
                </p>
              </>
            )}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function BatchProgress({ batch }: { batch: BatchState }) {
  const stage =
    batch.phase === "sfw"
      ? "Этап 1: отбираем SFW"
      : batch.phase === "nsfw"
        ? "SFW готово — этап 2: отбираем NSFW"
        : batch.phase === "preview"
          ? "Отбор завершён — отметьте превью"
          : "Пак готов к сборке";
  const pct = Math.min(100, Math.round((batch.total / Math.max(1, batch.targetTotal)) * 100));
  return (
    <div className="mb-3 rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{stage}</span>
        <span className="text-muted-foreground">
          {batch.total}/{batch.targetTotal}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex gap-2 text-[11px] text-muted-foreground">
        <span className={batch.phase === "sfw" ? "text-primary" : undefined}>
          SFW {batch.sfw.length}/{batch.sfwTarget}
        </span>
        <span className={batch.phase === "nsfw" ? "text-primary" : undefined}>
          NSFW {batch.nsfw.length}/{batch.nsfwTarget}
        </span>
        <span>
          Превью {batch.previews.length}/{batch.previewTarget}
        </span>
      </div>
    </div>
  );
}

function PackReady({ charId }: { charId: string | null }) {
  return (
    <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/5 p-8 text-center">
      <PackageCheck className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 font-display text-lg font-semibold">Отбор завершён</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Осталось отметить 3–4 превью из отобранных SFW и собрать пак — только после этого начнётся
        апскейл.
      </p>
      <Button asChild className="mt-5">
        <Link to="/packs" search={{ character: charId ?? undefined }}>
          Перейти к паку
        </Link>
      </Button>
    </div>
  );
}

function NoCharacter() {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-border p-8 text-center">
      <h2 className="font-display text-lg font-semibold">Сначала создайте персонажа</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Все генерации, отбор и паки относятся к конкретному персонажу.
      </p>
      <Button asChild className="mt-5">
        <Link to="/characters">Создать персонажа</Link>
      </Button>
    </div>
  );
}

function KindPicker({
  kind,
  auto,
  onKind,
}: {
  kind: "sfw" | "nsfw";
  auto: "sfw" | "nsfw";
  onKind: (k: "sfw" | "nsfw" | null) => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {(["sfw", "nsfw"] as const).map((k) => (
        <button
          key={k}
          onClick={() => onKind(k === auto ? null : k)}
          className={`flex-1 rounded-full border px-3 py-1.5 text-xs uppercase transition ${
            kind === k
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          {k}
          {k === auto ? " •" : ""}
        </button>
      ))}
    </div>
  );
}

function EmptyInbox({ count }: { count: number }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-border p-8 text-center">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 font-display text-lg font-semibold">
        {count > 0 ? "Всё разобрано" : "Пока нечего отбирать"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {count > 0
          ? "Новые кадры появятся, как только компьютер их сгенерирует."
          : "Запустите агента на компьютере — он сам пришлёт превью новых генераций."}
      </p>
      <Button asChild variant="outline" className="mt-5">
        <Link to="/setup">Настроить агента</Link>
      </Button>
    </div>
  );
}

function CharacterPicker({
  chars,
  value,
  onChange,
}: {
  chars: { id: string; name: string }[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  if (chars.length === 0) {
    return (
      <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Добавьте персонажа, чтобы название и теги подставлялись сами —{" "}
        <Link to="/characters" className="underline underline-offset-2">
          Персонажи
        </Link>
      </p>
    );
  }
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
      {chars.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
            value === c.id
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function TemplatePicker({
  templates,
  value,
  onChange,
}: {
  templates: TemplateRow[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (templates.length === 0) {
    return (
      <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Создайте шаблон с тегами и опциями DeviantArt —{" "}
        <Link to="/templates" className="underline underline-offset-2">
          Шаблоны
        </Link>
      </p>
    );
  }
  return (
    <div className="mb-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <LayoutTemplate className="h-3.5 w-3.5" /> Шаблон публикации
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => onChange(null)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
            value === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          Без шаблона
        </button>
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
              value === t.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function FolderPicker({
  options,
  value,
  defaultFolder,
  onChange,
  onAdd,
}: {
  options: string[];
  value: string | null;
  defaultFolder: string | null;
  onChange: (v: string | null) => void;
  onAdd: () => void;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5" /> Папка на DeviantArt
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => onChange(null)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
            value === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          {defaultFolder ? `По умолчанию: ${defaultFolder}` : "По умолчанию"}
        </button>
        {options
          .filter((o) => o !== defaultFolder)
          .map((o) => (
            <button
              key={o}
              onClick={() => onChange(o)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
                value === o
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {o}
            </button>
          ))}
        <button
          onClick={onAdd}
          className="shrink-0 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          + Другая
        </button>
      </div>
    </div>
  );
}

function Card({ item }: { item: ImageRow }) {
  const { data: url } = useQuery({
    queryKey: ["preview", item.id],
    queryFn: () => signedPreview(item.preview_path),
  });
  const ratio = useMemo(
    () => (item.width && item.height ? item.width / item.height : 1),
    [item.width, item.height],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="grid place-items-center bg-black/40" style={{ aspectRatio: ratio }}>
        {url ? (
          <img src={url} alt={item.filename} className="h-full w-full object-contain" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium">{item.filename}</p>
        {item.width && item.height && (
          <p className="text-[11px] text-muted-foreground">
            {item.width}×{item.height}
          </p>
        )}
      </div>
    </div>
  );
}
