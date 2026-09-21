import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Inbox, Undo2, Trash2, PackageCheck, Play, Pause, ChevronDown } from "lucide-react";
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
  REJECT_REASONS,
  type RejectReason,
  type ImageRow,
} from "@/lib/images";
import { clearInbox, fetchSelection } from "@/lib/packs";
import { batchState, resetBatch, type BatchState } from "@/lib/batch";
import { pauseGeneration, startGeneration } from "@/lib/generation";
import { recallCharacter, rememberCharacter } from "@/lib/styles";
import { SearchableSelect } from "@/components/searchable-select";


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
  const [last, setLast] = useState<{ id: string } | null>(null);
  const [kindOverride, setKindOverride] = useState<"sfw" | "nsfw" | null>(null);

  const inbox = useQuery({ queryKey: ["inbox"], queryFn: fetchInbox, refetchInterval: 20000 });
  const chars = useQuery({ queryKey: ["characters"], queryFn: fetchCharacters });

  // после обновления страницы открываем последнего выбранного персонажа
  useEffect(() => {
    if (charId === null && chars.data?.length) {
      const saved = recallCharacter();
      const remembered = saved ? chars.data.find((c) => c.id === saved) : undefined;
      setCharId((remembered ?? chars.data.find((c) => c.is_default) ?? chars.data[0]).id);
    }
  }, [chars.data, charId]);

  function selectCharacter(id: string) {
    setCharId(id);
    rememberCharacter(id);
  }


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

  const all = inbox.data ?? [];
  const doneSet = useMemo(() => new Set(done), [done]);
  // очередь стабильна: текущий кадр определяется по ID, а не по позиции в списке
  const items = useMemo(() => all.filter((i) => !doneSet.has(i.id)), [all, doneSet]);
  const current = items[0];
  const kind = kindOverride ?? batch.activeKind;

  async function act(
    status: "approved" | "rejected",
    reject?: { reasons: RejectReason[]; note: string },
  ) {
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
      await decide(id, status, charId, {
        contentKind: kind,
        isPreview: false,
        rejectReasons: reject?.reasons ?? [],
        rejectNote: reject?.note ?? null,
      });
      setDone((d) => (d.includes(id) ? d : [...d, id]));
      setLast({ id });
      setKindOverride(null);
      setReasonsOpen(false);
      void qc.invalidateQueries({ queryKey: ["selection"] });
      void qc.invalidateQueries({ queryKey: ["pipeline"] });
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    }
  }


  async function undo() {
    if (!last) return;
    try {
      await decide(last.id, "new", null);
      setDone((d) => d.filter((x) => x !== last.id));
      setLast(null);
      void inbox.refetch();
      void qc.invalidateQueries({ queryKey: ["selection"] });
    } catch (e) {
      toast.error(`Не удалось вернуть: ${(e as Error).message}`);
    }
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
          <div className="flex shrink-0 items-center gap-1">
            {activeChar && (
              <Button
                variant="ghost"
                size="sm"
                className="px-2 sm:px-3"
                onClick={async () => {
                  try {
                    if (activeChar.generation_enabled) await pauseGeneration(activeChar.id);
                    else await startGeneration(activeChar.id);
                    toast.success(
                      activeChar.generation_enabled ? "Генерация на паузе" : "Генерация запущена",
                    );
                    void qc.invalidateQueries({ queryKey: ["characters"] });
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                {activeChar.generation_enabled ? (
                  <>
                    <Pause className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Пауза</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Запустить</span>
                  </>
                )}
              </Button>
            )}
            {last && (
              <Button variant="ghost" size="sm" className="px-2 sm:px-3" onClick={undo}>
                <Undo2 className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Вернуть</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="px-2 text-destructive sm:px-3">
                  <Trash2 className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Очистить</span>
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
            <CharacterPicker chars={chars.data ?? []} value={charId} onChange={selectCharacter} />
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
                <KindPicker kind={kind} auto={batch.activeKind} onKind={setKindOverride} />

                <Card item={current} />

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="flex gap-1">
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-16 flex-1 text-base"
                      onClick={() => act("rejected")}
                    >
                      <X className="mr-2 h-5 w-5" /> Мимо
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="lg"
                          variant="outline"
                          className="h-16 w-10 px-0"
                          aria-label="Отклонить с причиной"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-52">
                        {REJECT_REASONS.map((r) => (
                          <DropdownMenuItem key={r.value} onSelect={() => void act("rejected", r.value)}>
                            {r.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
    <div className="mb-3">
      <SearchableSelect
        value={value}
        placeholder="Выберите персонажа"
        emptyText="Персонаж не найден"
        options={chars.map((c) => ({ value: c.id, label: c.name }))}
        onChange={onChange}
      />
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
