import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import JSZip from "jszip";
import {
  FolderPlus,
  Loader2,
  Star,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Package,
  Copy,
  PartyPopper,
  Trash2,
  Plus,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type FileItem,
  saveHandle,
  saveItem,
  getHandle,
  verifyPermission,
} from "@/lib/gallery-store";
import {
  type Release,
  type Character,
  type Step,
  STEPS,
  STEP_LABELS,
  SCENE_GROUPS,
  buildTitle,
  createRelease,
  saveRelease,
  getActiveReleaseId,
  getRelease,
  setActiveReleaseId,
  deleteRelease,
  getAllCharacters,
  createCharacter,
} from "@/lib/pipeline-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Furry Content Manager — конвейер релизов" },
      {
        name: "description",
        content:
          "Локальный конвейер для подготовки AI-изображений к публикации: импорт, отбор, теги, пак, релиз.",
      },
    ],
  }),
  component: PipelinePage,
});

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;

function PipelinePage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const id = await getActiveReleaseId();
    if (!id) {
      setRelease(null);
      return;
    }
    const r = await getRelease(id);
    setRelease(r ?? null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function update(patch: Partial<Release>) {
    if (!release) return;
    const next = { ...release, ...patch };
    await saveRelease(next);
    setRelease(next);
  }

  async function goTo(step: Step) {
    await update({ step });
  }

  async function discard() {
    if (!release) return;
    if (!confirm("Сбросить текущий релиз? Файлы на диске не пострадают.")) return;
    await deleteRelease(release.id);
    await refresh();
  }

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const step: Step = release?.step ?? "import";

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      <Stepper current={step} />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">
        {step === "import" && (
          <ImportStep onCreated={refresh} hasRelease={!!release} discard={discard} />
        )}
        {step === "triage" && release && (
          <TriageStep release={release} onChange={update} />
        )}
        {step === "character" && release && (
          <CharacterStep release={release} onChange={update} />
        )}
        {step === "tags" && release && <TagsStep release={release} onChange={update} />}
        {step === "bundle" && release && <BundleStep release={release} onChange={update} />}
        {step === "publish" && release && (
          <PublishStep release={release} onChange={update} onFinish={refresh} />
        )}
        {step === "done" && release && (
          <DoneStep release={release} onNew={discard} />
        )}
      </div>

      {release && step !== "import" && step !== "done" && (
        <NavBar
          step={step}
          release={release}
          onBack={() => goTo(prevStep(step))}
          onNext={() => goTo(nextStep(step))}
        />
      )}
    </div>
  );
}

// ─── stepper ───────────────────────────────────────────────────────────
function Stepper({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current === "done" ? "publish" : current);
  return (
    <div className="border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <ol className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-4 text-xs">
        {STEPS.map((s, i) => {
          const done = i < idx || current === "done";
          const active = i === idx && current !== "done";
          return (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={`hidden truncate sm:inline ${
                  active ? "font-semibold text-foreground" : done ? "text-foreground/70" : "text-muted-foreground"
                }`}
              >
                {STEP_LABELS[s]}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={`mx-1 h-px flex-1 ${done ? "bg-primary/40" : "bg-border"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function nextStep(s: Step): Step {
  const i = STEPS.indexOf(s);
  return STEPS[Math.min(i + 1, STEPS.length - 1)];
}
function prevStep(s: Step): Step {
  const i = STEPS.indexOf(s);
  return STEPS[Math.max(i - 1, 0)];
}

// ─── nav bar ───────────────────────────────────────────────────────────
function NavBar({
  step,
  release,
  onBack,
  onNext,
}: {
  step: Step;
  release: Release;
  onBack: () => void;
  onNext: () => void;
}) {
  const canNext = canAdvance(step, release);
  const nextLabel = STEP_LABELS[nextStep(step)];
  return (
    <div className="sticky bottom-0 z-20 border-t border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3">
        <Button variant="ghost" onClick={onBack} disabled={step === "triage"}>
          <ChevronLeft /> Назад
        </Button>
        <Button onClick={onNext} disabled={!canNext} size="lg">
          Далее: {nextLabel} <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function canAdvance(step: Step, r: Release): boolean {
  switch (step) {
    case "triage":
      return r.starredIds.length > 0;
    case "character":
      return !!r.characterId;
    case "tags":
      return r.title.trim().length > 0;
    case "bundle":
      return !!r.coverId;
    case "publish":
      return true;
    default:
      return true;
  }
}

// ─── step 1: import ────────────────────────────────────────────────────
function ImportStep({
  onCreated,
  hasRelease,
  discard,
}: {
  onCreated: () => void;
  hasRelease: boolean;
  discard: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function pick() {
    if (!("showDirectoryPicker" in window)) {
      alert("Браузер не поддерживает выбор папки. Используйте Chrome или Edge.");
      return;
    }
    setBusy(true);
    try {
      // @ts-expect-error file system api
      const dir: FileSystemDirectoryHandle = await window.showDirectoryPicker();
      const fileIds: string[] = [];
      await walkDir(dir, "", async (path, handle) => {
        if (!IMAGE_EXT.test(handle.name)) return;
        const file = await handle.getFile();
        const id = `${path}/${handle.name}::${file.size}::${file.lastModified}`;
        const item: FileItem = {
          id,
          name: handle.name,
          path: `${dir.name}${path}`,
          type: file.type || "image/*",
          size: file.size,
          addedAt: Date.now(),
          tagIds: [],
          collectionIds: [],
        };
        await saveHandle(id, handle);
        await saveItem(item);
        fileIds.push(id);
      });
      if (!fileIds.length) {
        alert("В папке не нашлось изображений.");
        return;
      }
      await createRelease(fileIds);
      onCreated();
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center text-center">
      <div className="mb-6 grid h-20 w-20 place-items-center rounded-3xl bg-primary/10 text-primary">
        <ImageIcon className="h-10 w-10" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Новый релиз</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Выберите папку с генерациями. Файлы остаются на диске — ничего не отправляется в сеть.
      </p>
      <Button size="lg" className="mt-8" onClick={pick} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
        Выбрать папку
      </Button>
      {hasRelease && (
        <button onClick={discard} className="mt-4 text-xs text-muted-foreground underline">
          Сбросить текущий релиз
        </button>
      )}
    </div>
  );
}

async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  visit: (path: string, file: FileSystemFileHandle) => Promise<void>,
) {
  const d = dir as unknown as { values: () => AsyncIterable<FileSystemHandle> };
  for await (const entry of d.values()) {
    if (entry.kind === "file") await visit(prefix, entry as FileSystemFileHandle);
    else if (entry.kind === "directory")
      await walkDir(entry as FileSystemDirectoryHandle, `${prefix}/${entry.name}`, visit);
  }
}

// ─── url cache ─────────────────────────────────────────────────────────
function useFileUrl(id: string | undefined) {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    let created: string | undefined;
    (async () => {
      if (!id) return;
      const h = await getHandle(id);
      if (!h || !(await verifyPermission(h))) return;
      const f = await h.getFile();
      created = URL.createObjectURL(f);
      if (alive) setUrl(created);
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);
  return url;
}

async function loadFile(id: string): Promise<File | undefined> {
  const h = await getHandle(id);
  if (!h || !(await verifyPermission(h))) return;
  return h.getFile();
}

// ─── step 2: triage ────────────────────────────────────────────────────
function TriageStep({
  release,
  onChange,
}: {
  release: Release;
  onChange: (p: Partial<Release>) => void;
}) {
  const visible = useMemo(
    () => release.fileIds.filter((id) => !release.rejectedIds.includes(id)),
    [release.fileIds, release.rejectedIds],
  );
  const [idx, setIdx] = useState(0);
  const current = visible[idx];
  const url = useFileUrl(current);

  const star = (id: string) => {
    const has = release.starredIds.includes(id);
    onChange({
      starredIds: has ? release.starredIds.filter((x) => x !== id) : [...release.starredIds, id],
    });
  };
  const reject = (id: string) => {
    onChange({
      rejectedIds: [...release.rejectedIds, id],
      starredIds: release.starredIds.filter((x) => x !== id),
    });
    setIdx((i) => Math.min(i, visible.length - 2));
  };
  const move = (d: number) =>
    setIdx((i) => Math.max(0, Math.min(visible.length - 1, i + d)));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key.toLowerCase() === "f" && current) star(current);
      else if (e.key.toLowerCase() === "x" && current) reject(current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!visible.length) {
    return (
      <div className="grid flex-1 place-items-center text-muted-foreground">
        Все изображения отклонены. Вернитесь и выберите другую папку.
      </div>
    );
  }

  const isStarred = current && release.starredIds.includes(current);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {idx + 1} / {visible.length}
        </span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-amber-400" />
            {release.starredIds.length}
          </span>
          <span className="inline-flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> {release.rejectedIds.length}
          </span>
          <span className="hidden text-xs sm:inline">
            ← → листать · F избранное · X удалить
          </span>
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-muted/30">
        {url ? (
          <img src={url} alt="" className="max-h-[60vh] w-auto object-contain" />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
        {isStarred && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-400/95 px-3 py-1 text-xs font-semibold text-black">
            <Star className="h-3.5 w-3.5 fill-current" /> В подборке
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" onClick={() => move(-1)}>
          <ChevronLeft />
        </Button>
        <Button
          variant={isStarred ? "default" : "secondary"}
          onClick={() => current && star(current)}
        >
          <Star /> {isStarred ? "В подборке" : "В подборку"} (F)
        </Button>
        <Button variant="ghost" onClick={() => current && reject(current)}>
          <X /> Убрать (X)
        </Button>
        <Button variant="outline" size="icon" onClick={() => move(1)}>
          <ChevronRight />
        </Button>
      </div>

      <ThumbStrip
        ids={visible}
        currentId={current}
        starred={release.starredIds}
        onPick={(i) => setIdx(i)}
      />
    </div>
  );
}

function ThumbStrip({
  ids,
  currentId,
  starred,
  onPick,
}: {
  ids: string[];
  currentId?: string;
  starred: string[];
  onPick: (i: number) => void;
}) {
  return (
    <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2">
      {ids.map((id, i) => (
        <ThumbCell
          key={id}
          id={id}
          active={id === currentId}
          starred={starred.includes(id)}
          onClick={() => onPick(i)}
        />
      ))}
    </div>
  );
}
function ThumbCell({
  id,
  active,
  starred,
  onClick,
}: {
  id: string;
  active: boolean;
  starred: boolean;
  onClick: () => void;
}) {
  const url = useFileUrl(id);
  return (
    <button
      onClick={onClick}
      className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition ${
        active ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
      }`}
    >
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      {starred && (
        <Star className="absolute right-0.5 top-0.5 h-3 w-3 fill-amber-400 text-amber-400 drop-shadow" />
      )}
    </button>
  );
}

// ─── step 3: character ─────────────────────────────────────────────────
function CharacterStep({
  release,
  onChange,
}: {
  release: Release;
  onChange: (p: Partial<Release>) => void;
}) {
  const [chars, setChars] = useState<Character[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    species: "",
    baseTags: "",
    titleTemplate: "{character} — {scene} #{n}",
    notes: "",
  });

  const reload = useCallback(async () => setChars(await getAllCharacters()), []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function create() {
    if (!form.name.trim()) return;
    const c = await createCharacter({
      name: form.name.trim(),
      species: form.species.trim(),
      baseTags: form.baseTags.split(",").map((s) => s.trim()).filter(Boolean),
      titleTemplate: form.titleTemplate.trim() || "{character} — {scene} #{n}",
      notes: form.notes.trim(),
    });
    setCreating(false);
    setForm({ name: "", species: "", baseTags: "", titleTemplate: "{character} — {scene} #{n}", notes: "" });
    await reload();
    onChange({ characterId: c.id });
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Кто на изображениях?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Выберите персонажа — это задаст базовые теги и шаблон названия.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {chars.map((c) => {
          const active = c.id === release.characterId;
          return (
            <button
              key={c.id}
              onClick={() => onChange({ characterId: c.id })}
              className={`rounded-xl border p-4 text-left transition ${
                active
                  ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                  : "border-border/60 hover:border-primary/40 hover:bg-accent/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.species || "—"}</div>
                </div>
              </div>
              {c.baseTags.length > 0 && (
                <div className="mt-3 truncate text-[11px] text-muted-foreground">
                  {c.baseTags.map((t) => `#${t}`).join("  ")}
                </div>
              )}
            </button>
          );
        })}

        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="grid place-items-center rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Новый персонаж
            </span>
          </button>
        )}
      </div>

      {creating && (
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Новый персонаж</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="Имя"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              placeholder="Вид (например, fox, wolf)"
              value={form.species}
              onChange={(e) => setForm({ ...form, species: e.target.value })}
            />
            <Input
              className="sm:col-span-2"
              placeholder="Базовые теги через запятую"
              value={form.baseTags}
              onChange={(e) => setForm({ ...form, baseTags: e.target.value })}
            />
            <Input
              className="sm:col-span-2"
              placeholder="Шаблон названия"
              value={form.titleTemplate}
              onChange={(e) => setForm({ ...form, titleTemplate: e.target.value })}
            />
            <Textarea
              className="sm:col-span-2"
              placeholder="Заметки"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Отмена
            </Button>
            <Button onClick={create}>Создать и выбрать</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── step 4: tags & title ──────────────────────────────────────────────
function TagsStep({
  release,
  onChange,
}: {
  release: Release;
  onChange: (p: Partial<Release>) => void;
}) {
  const [character, setCharacter] = useState<Character | null>(null);
  useEffect(() => {
    if (!release.characterId) return;
    getAllCharacters().then((cs) =>
      setCharacter(cs.find((c) => c.id === release.characterId) ?? null),
    );
  }, [release.characterId]);

  const allTags = useMemo(() => {
    const base = character?.baseTags ?? [];
    return Array.from(new Set([...base, ...release.sceneChips, ...release.customTags]));
  }, [character, release.sceneChips, release.customTags]);

  const sceneLabel = release.sceneChips[0] ?? "set";

  // auto-fill title when empty or scene changes
  useEffect(() => {
    if (!character) return;
    const proposed = buildTitle(character.titleTemplate, character.name, sceneLabel, release.releaseNumber);
    if (!release.title) onChange({ title: proposed });
  }, [character, sceneLabel]);

  function toggleChip(chip: string) {
    onChange({
      sceneChips: release.sceneChips.includes(chip)
        ? release.sceneChips.filter((c) => c !== chip)
        : [...release.sceneChips, chip],
    });
  }
  function reroll() {
    if (!character) return;
    onChange({
      title: buildTitle(character.titleTemplate, character.name, sceneLabel, release.releaseNumber),
    });
  }

  const [newTag, setNewTag] = useState("");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Название и теги</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Всё уже заполнено. Поправьте при необходимости.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-4">
        <label className="text-xs font-medium text-muted-foreground">Название</label>
        <div className="mt-2 flex gap-2">
          <Input
            value={release.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="text-base font-medium"
          />
          <Button variant="outline" onClick={reroll} title="Сгенерировать заново">
            <Sparkles />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {SCENE_GROUPS.map((g) => (
          <div key={g.key}>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              {g.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.chips.map((chip) => {
                const on = release.sceneChips.includes(chip);
                return (
                  <button
                    key={chip}
                    onClick={() => toggleChip(chip)}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      on
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-accent"
                    }`}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          Итоговые теги
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              #{t}
              {release.customTags.includes(t) && (
                <button
                  onClick={() =>
                    onChange({ customTags: release.customTags.filter((x) => x !== t) })
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Добавить тег и Enter"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTag.trim()) {
                const t = newTag.trim().replace(/^#/, "");
                if (!release.customTags.includes(t))
                  onChange({ customTags: [...release.customTags, t] });
                setNewTag("");
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── step 5: bundle ────────────────────────────────────────────────────
function BundleStep({
  release,
  onChange,
}: {
  release: Release;
  onChange: (p: Partial<Release>) => void;
}) {
  const [building, setBuilding] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | undefined>();

  const character = useCharacterLookup(release.characterId);
  const tags = useMemo(
    () =>
      Array.from(
        new Set([...(character?.baseTags ?? []), ...release.sceneChips, ...release.customTags]),
      ),
    [character, release.sceneChips, release.customTags],
  );

  async function regenPreview(id: string) {
    const file = await loadFile(id);
    if (!file) return;
    const blob = await composeCover(file, release.title, `${release.starredIds.length} arts · by ${character?.name ?? ""}`);
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
  }

  useEffect(() => {
    if (release.coverId) regenPreview(release.coverId);
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release.coverId, release.title]);

  async function buildZip() {
    setBuilding(true);
    try {
      const zip = new JSZip();
      let coverBlob: Blob | null = null;
      if (release.coverId) {
        const f = await loadFile(release.coverId);
        if (f) {
          coverBlob = await composeCover(
            f,
            release.title,
            `${release.starredIds.length} arts · by ${character?.name ?? ""}`,
          );
          zip.file("cover.jpg", coverBlob);
        }
      }
      const folder = zip.folder("images")!;
      for (const id of release.starredIds) {
        const f = await loadFile(id);
        if (f) folder.file(f.name, f);
      }
      const readme = [
        release.title,
        "",
        `Персонаж: ${character?.name ?? ""}`,
        `Изображений: ${release.starredIds.length}`,
        `Теги: ${tags.map((t) => "#" + t).join(" ")}`,
        "",
        release.packDescription,
      ].join("\n");
      zip.file("README.txt", readme);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(release.title || release.packName)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Сборка пака</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Выберите изображение для обложки — поверх него будет надпись с названием пака.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {release.starredIds.map((id) => (
            <CoverPick
              key={id}
              id={id}
              selected={id === release.coverId}
              onPick={() => onChange({ coverId: id })}
            />
          ))}
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/30">
            {coverPreview ? (
              <img src={coverPreview} alt="" className="w-full" />
            ) : (
              <div className="grid aspect-square place-items-center text-xs text-muted-foreground">
                Выберите изображение для обложки
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Файлов</span>
              <span className="font-medium">{release.starredIds.length}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">Имя архива</span>
              <span className="font-mono text-xs">{slugify(release.title || release.packName)}.zip</span>
            </div>
          </div>

          <Button className="w-full" onClick={buildZip} disabled={!release.coverId || building}>
            {building ? <Loader2 className="animate-spin" /> : <Package />}
            Сформировать пак
          </Button>
        </div>
      </div>
    </div>
  );
}

function CoverPick({
  id,
  selected,
  onPick,
}: {
  id: string;
  selected: boolean;
  onPick: () => void;
}) {
  const url = useFileUrl(id);
  return (
    <button
      onClick={onPick}
      className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${
        selected ? "border-primary ring-2 ring-primary/40" : "border-transparent opacity-80 hover:opacity-100"
      }`}
    >
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      {selected && (
        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

async function composeCover(file: File, title: string, subtitle: string): Promise<Blob> {
  const img = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const grad = ctx.createLinearGradient(0, canvas.height * 0.5, 0, canvas.height);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.88)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, canvas.height * 0.5, canvas.width, canvas.height * 0.5);
  const fs = Math.round(canvas.width * 0.052);
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(wrapEllipsis(title, canvas.width * 0.88, ctx), canvas.width * 0.06, canvas.height - fs * 1.8);
  ctx.font = `${Math.round(fs * 0.5)}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(subtitle, canvas.width * 0.06, canvas.height - fs * 0.7);
  return new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.92));
}
function wrapEllipsis(text: string, max: number, ctx: CanvasRenderingContext2D): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 4 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
}
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "release";
}

function useCharacterLookup(id?: string) {
  const [c, setC] = useState<Character | null>(null);
  useEffect(() => {
    if (!id) return;
    getAllCharacters().then((cs) => setC(cs.find((x) => x.id === id) ?? null));
  }, [id]);
  return c;
}

// ─── step 6: publish ───────────────────────────────────────────────────
function PublishStep({
  release,
  onChange,
  onFinish,
}: {
  release: Release;
  onChange: (p: Partial<Release>) => void;
  onFinish: () => void;
}) {
  const character = useCharacterLookup(release.characterId);
  const url = useFileUrl(release.coverId);
  const tags = useMemo(
    () =>
      Array.from(
        new Set([...(character?.baseTags ?? []), ...release.sceneChips, ...release.customTags]),
      ),
    [character, release.sceneChips, release.customTags],
  );

  const description = useMemo(() => {
    return [
      release.title,
      "",
      release.packDescription || `Pack of ${release.starredIds.length} arts featuring ${character?.name ?? ""}.`,
      "",
      tags.map((t) => "#" + t).join(" "),
    ].join("\n");
  }, [release, character, tags]);

  function copyDesc() {
    navigator.clipboard.writeText(description);
  }

  async function finish() {
    await saveRelease({ ...release, step: "done", completedAt: Date.now() });
    onFinish();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Публикация для DeviantArt</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Превью поста. Скопируйте описание — и публикуйте.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/30">
          {url ? (
            <img src={url} alt="" className="w-full object-contain" />
          ) : (
            <div className="grid aspect-square place-items-center text-xs text-muted-foreground">
              Нет обложки
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Заголовок</label>
            <Input
              className="mt-1 text-base font-semibold"
              value={release.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Описание</label>
            <Textarea
              className="mt-1 min-h-[160px] font-mono text-xs"
              value={release.packDescription}
              placeholder={`Pack of ${release.starredIds.length} arts featuring ${character?.name ?? ""}.`}
              onChange={(e) => onChange({ packDescription: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Хэштеги</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  #{t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copyDesc} variant="outline">
              <Copy /> Скопировать описание
            </Button>
            <Button onClick={finish}>
              <Check /> Завершить релиз
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── done ──────────────────────────────────────────────────────────────
function DoneStep({ release, onNew }: { release: Release; onNew: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="mb-6 grid h-20 w-20 place-items-center rounded-3xl bg-emerald-500/15 text-emerald-500">
        <PartyPopper className="h-10 w-10" />
      </div>
      <h1 className="text-3xl font-semibold">Релиз готов</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        «{release.title}» — {release.starredIds.length} изображений сохранены в архив.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={async () => { await setActiveReleaseId(undefined); location.reload(); }}>
          <FolderPlus /> Новый релиз
        </Button>
        <Button variant="outline" asChild>
          <Link to="/archive">В архив</Link>
        </Button>
        <Button variant="ghost" onClick={onNew}>
          <Trash2 /> Удалить
        </Button>
      </div>
    </div>
  );
}
