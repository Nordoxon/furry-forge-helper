import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BottomNav } from "@/components/bottom-nav";
import { CensorEditor } from "@/components/censor-editor";
import {
  ITEM_STATUS,
  addItems,
  chooseVariant,
  createSeries,
  deleteItem,
  fetchItems,
  fetchSeriesList,
  fetchSettings,
  fetchVariants,
  saveSettings,
  signed,
  updateItem,
  updateSeries,
  uploadCensored,
  type Series,
  type SeriesItem,
} from "@/lib/series";

export const Route = createFileRoute("/_authenticated/series")({
  head: () => ({
    meta: [
      { title: "Отдельные эксклюзивы — Furry Content Manager" },
      { name: "description", content: "Серии персонажей в одной сцене: генерация вариантов, выбор, апскейл, цензура превью и загрузка на DeviantArt." },
      { property: "og:title", content: "Отдельные эксклюзивы — Furry Content Manager" },
      { property: "og:description", content: "Один персонаж — один эксклюзив: серия в общей сцене." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SeriesPage,
});

function SeriesPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["user-settings"], queryFn: fetchSettings });
  const list = useQuery({ queryKey: ["series"], queryFn: fetchSeriesList });
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = (list.data ?? []).find((s) => s.id === activeId) ?? list.data?.[0] ?? null;

  const setMode = useMutation({
    mutationFn: (mode: string) => saveSettings({ mode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-settings"] });
      toast.success("Режим переключён");
    },
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 p-4">
        <h1 className="text-xl font-semibold">Режим работы</h1>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { v: "pack", t: "Паки 8+23", d: "Персонаж → 8 SFW + 23 NSFW → ZIP" },
            { v: "series", t: "Отдельные эксклюзивы", d: "Серия персонажей в одной сцене" },
          ].map((m) => {
            const on = (settings.data?.mode ?? "pack") === m.v;
            return (
              <button
                key={m.v}
                type="button"
                onClick={() => !on && setMode.mutate(m.v)}
                className={`flex min-h-14 items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                  on ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                  {on && <Check className="h-3 w-3 text-primary-foreground" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{m.t}</span>
                  <span className="block text-xs text-muted-foreground">{m.d}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Агент генерирует только для выбранного режима. Нужен FORGE_QUEUE = True.
        </p>

        {settings.data && <NumberingCard s={settings.data} />}

        <NewSeries onCreated={(id) => setActiveId(id)} />

        {(list.data ?? []).length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {list.data!.map((s) => (
              <Button key={s.id} size="sm" variant={s.id === active?.id ? "default" : "outline"} onClick={() => setActiveId(s.id)}>
                {s.title || s.scene_name || "Серия"}
              </Button>
            ))}
          </div>
        )}
        {active && <SeriesView series={active} />}
      </main>
      <BottomNav />
    </div>
  );
}

function NumberingCard({ s }: { s: { title_template: string; next_exclusive_number: number; default_tags: string[] } }) {
  const qc = useQueryClient();
  const [tpl, setTpl] = useState(s.title_template);
  const [num, setNum] = useState(String(s.next_exclusive_number));
  const [tags, setTags] = useState(s.default_tags.join(", "));
  const save = useMutation({
    mutationFn: () =>
      saveSettings({
        title_template: tpl,
        next_exclusive_number: Math.max(1, Number(num) || 1),
        default_tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-settings"] });
      toast.success("Сохранено");
    },
  });
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="font-medium">Нумерация и теги</h2>
      <Label className="text-xs">Шаблон названия ({"{number}"}, {"{character}"})</Label>
      <Input value={tpl} onChange={(e) => setTpl(e.target.value)} />
      <Label className="text-xs">Следующий номер эксклюзива</Label>
      <Input inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value)} />
      <Label className="text-xs">Теги по умолчанию (через запятую)</Label>
      <Input value={tags} onChange={(e) => setTags(e.target.value)} />
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
    </section>
  );
}

function NewSeries({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    scene_name: "",
    scene_background: "",
    scene_composition: "",
    prompt: "{character}, {background}, {composition}, masterpiece, best quality",
    negative_prompt: "",
    width: "832",
    height: "1216",
    steps: "28",
    cfg: "5",
    sampler: "Euler a",
    variants: "3",
    names: "",
    auto_upscale: true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: () =>
      createSeries(
        {
          title: f.scene_name,
          scene_name: f.scene_name,
          scene_background: f.scene_background,
          scene_composition: f.scene_composition,
          prompt: f.prompt,
          negative_prompt: f.negative_prompt,
          variants: Math.max(1, Number(f.variants) || 3),
          auto_upscale: f.auto_upscale,
          settings: {
            width: Number(f.width),
            height: Number(f.height),
            steps: Number(f.steps),
            cfg_scale: Number(f.cfg),
            sampler_name: f.sampler,
          },
        },
        f.names.split(/\n|,/),
      ),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["series"] });
      onCreated(s.id);
      setOpen(false);
      toast.success("Серия создана");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!open)
    return (
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Новая серия
      </Button>
    );
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="font-medium">Новая серия — общая сцена</h2>
      <Label className="text-xs">Название сцены → {"{scene}"}</Label>
      <Input placeholder="Beach Sunset" value={f.scene_name} onChange={set("scene_name")} />
      <Label className="text-xs">Фон → {"{background}"}</Label>
      <Input placeholder="beach, sunset, ocean" value={f.scene_background} onChange={set("scene_background")} />
      <Label className="text-xs">Поза/композиция → {"{composition}"}</Label>
      <Input placeholder="standing, looking at viewer" value={f.scene_composition} onChange={set("scene_composition")} />
      <Label className="text-xs">Промпт</Label>
      <Textarea rows={3} value={f.prompt} onChange={set("prompt")} />
      <p className="text-[11px] text-muted-foreground">
        В промпт попадает только то, что указано метками в фигурных скобках. {"{character}"} — имя персонажа. Если метки в промпте нет, поле не используется.
      </p>
      <Label className="text-xs">Негативный промпт</Label>
      <Textarea rows={2} value={f.negative_prompt} onChange={set("negative_prompt")} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Input placeholder="Ширина" value={f.width} onChange={set("width")} />
        <Input placeholder="Высота" value={f.height} onChange={set("height")} />
        <Input placeholder="Steps" value={f.steps} onChange={set("steps")} />
        <Input placeholder="CFG" value={f.cfg} onChange={set("cfg")} />
        <Input placeholder="Sampler" value={f.sampler} onChange={set("sampler")} className="col-span-2 sm:col-span-2" />
      </div>
      <Label className="text-xs">Вариантов на персонажа</Label>
      <Input inputMode="numeric" value={f.variants} onChange={set("variants")} />
      <div className="flex items-center gap-2">
        <Switch checked={f.auto_upscale} onCheckedChange={(v) => setF((x) => ({ ...x, auto_upscale: v }))} />
        <span className="text-sm">Апскейл сразу после выбора</span>
      </div>
      <Label className="text-xs">Персонажи из styles.csv — по одному на строку</Label>
      <Textarea rows={5} placeholder={"Lucario\nRenamon\nKrystal"} value={f.names} onChange={set("names")} />
      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || !f.names.trim()}>Создать</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
      </div>
    </section>
  );
}

function SeriesView({ series }: { series: Series }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["series-items", series.id], queryFn: () => fetchItems(series.id), refetchInterval: 8000 });
  const variants = useQuery({ queryKey: ["series-variants", series.id], queryFn: () => fetchVariants(series.id), refetchInterval: 8000 });
  const [more, setMore] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["series-items", series.id] });
    qc.invalidateQueries({ queryKey: ["series-variants", series.id] });
    qc.invalidateQueries({ queryKey: ["series"] });
  };
  const toggle = useMutation({
    mutationFn: () => updateSeries(series.id, { status: series.status === "running" ? "paused" : "running" }),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: () => addItems(series.id, more.split(/\n|,/), (items.data ?? []).length),
    onSuccess: () => {
      setMore("");
      refresh();
    },
  });
  const all = items.data ?? [];
  const done = all.filter((i) => i.status === "published").length;

  const remove = useMutation({
    mutationFn: () => deleteSeries(series.id),
    onSuccess: () => {
      toast.success("Сцена удалена");
      qc.invalidateQueries({ queryKey: ["series"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{series.scene_name || "Серия"}</h2>
          <p className="text-xs text-muted-foreground">
            {done}/{all.length} на DeviantArt · {series.variants} вар. на персонажа
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="icon" variant="outline" aria-label="Редактировать сцену" onClick={() => setEditing((v) => !v)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Удалить сцену"
            onClick={() => {
              if (confirm("Удалить сцену и список её персонажей? Готовые картинки останутся.")) remove.mutate();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button onClick={() => toggle.mutate()} variant={series.status === "running" ? "outline" : "default"}>
            {series.status === "running" ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {series.status === "running" ? "Пауза" : "Запустить"}
          </Button>
        </div>
      </div>
      {editing && <EditScene series={series} onDone={() => { setEditing(false); refresh(); }} />}
      {all.map((it) => (
        <ItemCard
          key={it.id}
          item={it}
          series={series}
          variants={(variants.data ?? []).filter((v) => v.series_item_id === it.id)}
          onChange={refresh}
        />
      ))}
      <div className="flex gap-2">
        <Input placeholder="Добавить персонажей (через запятую)" value={more} onChange={(e) => setMore(e.target.value)} />
        <Button size="icon" onClick={() => add.mutate()} disabled={!more.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

type Variant = { id: string; preview_path: string | null; status: string };

function Thumb({ path, onClick, selected }: { path: string | null; onClick?: () => void; selected?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    signed(path).then(setUrl);
  }, [path]);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative aspect-[2/3] overflow-hidden rounded-md border-2 ${selected ? "border-primary" : "border-transparent"} bg-muted`}
    >
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      {selected && <Check className="absolute right-1 top-1 h-5 w-5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
    </button>
  );
}

function ItemCard({ item, series, variants, onChange }: { item: SeriesItem; series: Series; variants: Variant[]; onChange: () => void }) {
  const [editor, setEditor] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const selected = variants.find((v) => v.id === item.selected_image_id);
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: onChange,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {item.exclusive_number ? `#${item.exclusive_number} ` : ""}
            {item.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {ITEM_STATUS[item.status] ?? item.status} · {variants.length} вар.
            {item.error ? ` · ${item.error}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {["choosing", "waiting", "generating"].includes(item.status) && (
            <Button
              size="sm"
              variant="outline"
              title="Ещё 3 варианта"
              onClick={() => act.mutate(() => updateItem(item.id, { requested_variants: item.requested_variants + 3, status: "waiting" }))}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          {item.status === "waiting" && (
            <Button size="sm" variant="ghost" onClick={() => act.mutate(() => deleteItem(item.id))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {variants.length > 0 && !["published"].includes(item.status) && (
        <div className="grid grid-cols-3 gap-2">
          {variants.map((v) => (
            <Thumb
              key={v.id}
              path={v.preview_path}
              selected={v.id === item.selected_image_id}
              onClick={
                ["choosing", "generating", "waiting", "chosen", "selected"].includes(item.status)
                  ? () => act.mutate(() => chooseVariant(item, series, v.id))
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {item.title && <p className="text-xs">{item.title}</p>}

      {item.status === "chosen" && (
        <Button size="sm" onClick={() => act.mutate(() => updateItem(item.id, { status: "selected" }))}>
          Запустить апскейл
        </Button>
      )}
      {["upscaled", "preview_ready", "error"].includes(item.status) && selected && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={async () => {
              setSrc(await signed(selected.preview_path));
              setEditor(true);
            }}
          >
            {item.censored_preview_path ? "Переделать цензуру" : "Цензура превью"}
          </Button>
          {item.censored_preview_path && item.status !== "preview_ready" && (
            <Button size="sm" variant="outline" onClick={() => act.mutate(() => updateItem(item.id, { status: "preview_ready", error: null }))}>
              Загрузить на DA
            </Button>
          )}
        </div>
      )}
      {item.original_local_path && <p className="break-all text-[11px] text-muted-foreground">Оригинал на ПК: {item.original_local_path}</p>}
      {item.deviation_url && (
        <a href={item.deviation_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          Открыть на DeviantArt — прикрепите оригинал через Edit
        </a>
      )}
      {act.isPending && <Loader2 className="h-4 w-4 animate-spin" />}

      <CensorEditor
        src={src}
        open={editor}
        onOpenChange={setEditor}
        watermark={series.watermark ? `#${item.exclusive_number ?? ""}` : ""}
        onSave={async (blob) => {
          await uploadCensored(item, blob);
          await updateItem(item.id, { status: "preview_ready", error: null });
          toast.success("Превью сохранено — агент загрузит его на DeviantArt");
          onChange();
        }}
      />
    </div>
  );
}
