import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pause, Pencil, Play, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BottomNav } from "@/components/bottom-nav";
import { CensorEditor } from "@/components/censor-editor";
import { validateDeviationUrl } from "@/lib/series-description";
import {
  ITEM_STATUS,
  addItems,
  chooseVariant,
  createSeries,
  deleteItem,
  deleteSeries,
  fetchItems,
  fetchSeriesList,
  fetchSettings,
  fetchVariants,
  saveSettings,
  signed,
  updateItem,
  unchooseVariant,
  updateSeries,
  uploadCensored,
  type Series,
  type SeriesItem,
  type UserSettings,
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
        {settings.data && <ExclusiveSettingsCard s={settings.data} />}

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
      <Label className="text-xs">Теги для DeviantArt (через запятую)</Label>
      <p className="text-xs text-muted-foreground">Для персонажей, которые не созданы отдельно: эти теги плюс имя. У созданного персонажа берутся его личные теги.</p>
      <Input value={tags} onChange={(e) => setTags(e.target.value)} />
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
    </section>
  );
}

const CLASSES = [
  ["nudity", "Нагота"],
  ["sexual", "Сексуальное"],
  ["gore", "Жестокость"],
  ["language", "Лексика"],
  ["ideology", "Идеология"],
] as const;

function ExclusiveSettingsCard({ s }: { s: UserSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    exclusive_price: String(s.exclusive_price),
    exclusive_sale_type: s.exclusive_sale_type,
    exclusive_topic: s.exclusive_topic,
    gallery_folder: s.gallery_folder,
    auto_publish_exclusive: s.auto_publish_exclusive,
    listing_confirm: s.listing_confirm,
    auto_censor: s.auto_censor,
    mature_level: s.mature_level,
    mature_classification: s.mature_classification,
    allow_resales: s.allow_resales,
    early_access: s.early_access,
    description_template: s.description_template,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => saveSettings({ ...f, exclusive_price: Math.max(0, Number(f.exclusive_price) || 0) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-settings"] });
      toast.success("Сохранено");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const presetCount = Array.isArray(s.censor_preset) ? s.censor_preset.length : 0;
  const sw = (k: "auto_publish_exclusive" | "listing_confirm" | "auto_censor" | "allow_resales" | "early_access", t: string, d?: string) => (
    <label className="flex items-start justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="block text-sm">{t}</span>
        {d && <span className="block text-xs text-muted-foreground">{d}</span>}
      </span>
      <Switch checked={f[k]} onCheckedChange={(v) => set(k, v)} />
    </label>
  );
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="font-medium">Продажа и публикация</h2>
      {sw("auto_publish_exclusive", "Автоматическая цепочка", "Скрипт сам публикует превью, грузит оригинал в Sta.sh и заполняет продажу. Выключено — превью остаётся черновиком.")}
      {sw("auto_censor", "Автоцензура по шаблону", presetCount ? `В шаблоне областей: ${presetCount}` : "Шаблона пока нет — сохраните его в окне цензуры.")}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Цена</Label>
          <Input inputMode="decimal" value={f.exclusive_price} onChange={(e) => set("exclusive_price", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Тип продажи</Label>
          <select className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={f.exclusive_sale_type} onChange={(e) => set("exclusive_sale_type", e.target.value)}>
            <option value="fixed">Фиксированная цена</option>
            <option value="offers">Предложения</option>
            <option value="both">Оба</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Topic</Label>
          <Input value={f.exclusive_topic} onChange={(e) => set("exclusive_topic", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Папка галереи</Label>
          <Input value={f.gallery_folder} onChange={(e) => set("gallery_folder", e.target.value)} />
        </div>
      </div>
      {sw("allow_resales", "Разрешить перепродажу")}
      {sw("early_access", "Ранний доступ")}
      <Label className="text-xs">Уровень mature</Label>
      <select className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={f.mature_level} onChange={(e) => set("mature_level", e.target.value)}>
        <option value="moderate">Moderate</option>
        <option value="strict">Strict</option>
      </select>
      <div className="flex flex-wrap gap-2">
        {CLASSES.map(([v, t]) => {
          const on = f.mature_classification.includes(v);
          return (
            <Button
              key={v}
              size="sm"
              type="button"
              variant={on ? "default" : "outline"}
              onClick={() => set("mature_classification", on ? f.mature_classification.filter((x) => x !== v) : [...f.mature_classification, v])}
            >
              {t}
            </Button>
          );
        })}
      </div>
      <Label className="text-xs">Шаблон описания ({"{number}"}, {"{character}"}, {"{scene}"})</Label>
      <p className="text-xs text-muted-foreground">Используется, если у персонажа нет своего описания.</p>
      <Textarea rows={3} value={f.description_template} onChange={(e) => set("description_template", e.target.value)} />
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

function EditScene({ series, onDone }: { series: Series; onDone: () => void }) {
  const [f, setF] = useState({
    scene_name: series.scene_name,
    scene_background: series.scene_background,
    scene_composition: series.scene_composition,
    prompt: series.prompt,
    negative_prompt: series.negative_prompt,
    variants: String(series.variants),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      updateSeries(series.id, {
        scene_name: f.scene_name,
        title: f.scene_name,
        scene_background: f.scene_background,
        scene_composition: f.scene_composition,
        prompt: f.prompt,
        negative_prompt: f.negative_prompt,
        variants: Math.max(1, Number(f.variants) || 3),
      }),
    onSuccess: () => {
      toast.success("Сцена сохранена");
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card p-3">
      <Label className="text-xs">Название сцены → {"{scene}"}</Label>
      <Input value={f.scene_name} onChange={set("scene_name")} />
      <Label className="text-xs">Фон → {"{background}"}</Label>
      <Input value={f.scene_background} onChange={set("scene_background")} />
      <Label className="text-xs">Поза / композиция → {"{composition}"}</Label>
      <Input value={f.scene_composition} onChange={set("scene_composition")} />
      <Label className="text-xs">Промпт</Label>
      <Textarea rows={3} value={f.prompt} onChange={set("prompt")} />
      <Label className="text-xs">Негативный промпт</Label>
      <Textarea rows={2} value={f.negative_prompt} onChange={set("negative_prompt")} />
      <Label className="text-xs">Вариантов на персонажа</Label>
      <Input type="number" min={1} value={f.variants} onChange={set("variants")} />
      <p className="text-xs text-muted-foreground">Изменения действуют на новые генерации.</p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
        <Button variant="outline" onClick={onDone}>Отмена</Button>
      </div>
    </div>
  );
}


function SeriesView({ series }: { series: Series }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["series-items", series.id], queryFn: () => fetchItems(series.id), refetchInterval: 8000 });
  const variants = useQuery({ queryKey: ["series-variants", series.id], queryFn: () => fetchVariants(series.id), refetchInterval: 8000 });
  const [more, setMore] = useState("");
  const [editing, setEditing] = useState(false);
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

function ManualPublished({ onSave }: { onSave: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Я опубликовал сам
      </Button>
    );
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://www.deviantart.com/..." />
      <Button
        size="sm"
        onClick={() => {
          const url = validateDeviationUrl(v);
          if (!url) return toast.error("Нужна ссылка https:// на deviantart.com или sta.sh");
          onSave(url);
          setOpen(false);
        }}
      >
        Сохранить
      </Button>
    </div>
  );
}

function DescriptionField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const dirty = v !== value;
  return (
    <div className="space-y-1">
      <Label className="text-xs">Описание для DeviantArt</Label>
      <Textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} placeholder="Текст будет передан на DA без изменений" />
      {dirty && (
        <Button size="sm" variant="outline" onClick={() => onSave(v)}>
          Сохранить описание
        </Button>
      )}
    </div>
  );
}

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
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["user-settings"], queryFn: fetchSettings });
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
          {item.selected_image_id && item.status !== "published" && (
            <Button
              size="sm"
              variant="outline"
              title="Отменить выбор"
              onClick={() => {
                if (confirm(`Отменить выбор для ${item.name}? Все варианты снова появятся в отборе.`))
                  act.mutate(() => unchooseVariant(item));
              }}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            title="Удалить персонажа"
            onClick={() => {
              if (confirm(`Удалить ${item.name} из серии? Готовые картинки останутся.`))
                act.mutate(() => deleteItem(item.id));
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
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

      {item.status !== "published" && (
        <DescriptionField
          value={(item as { description?: string }).description ?? ""}
          onSave={(d) => act.mutate(() => updateItem(item.id, { description: d } as never))}
        />
      )}

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
      {item.status === "draft" && (
        <ManualPublished onSave={(url) => act.mutate(() => updateItem(item.id, { status: "published", deviation_url: url, listing_status: "pending", listing_error: null } as never))} />
      )}
      <Pipeline item={item} />
      {!((item as { description?: string }).description ?? "").trim() && !settingsQ.data?.description_template?.trim() && item.selected_image_id && (
        <p className="text-xs text-destructive">Нет описания и шаблона — работа уйдёт с пустым описанием.</p>
      )}
      {item.status === "published" && (
        <div className="space-y-1">
          <p className="text-xs">
            Продажа: {LISTING[item.listing_status] ?? item.listing_status}
            {item.listing_error && item.listing_status !== "manual" ? ` — ${item.listing_error}` : ""}
          </p>
          {item.listing_status === "manual" && (
            <ol className="list-decimal space-y-0.5 rounded-md border border-border bg-muted/40 p-2 pl-6 text-xs">
              <li>В открывшемся браузере на странице работы нажмите «Sell Deviation» → «Exclusives».</li>
              <li>
                Источник — перетащите файл оригинала (проводник уже открыт{item.original_local_path ? `, путь ${item.original_local_path}` : ""}) или вставьте ссылку черновика «SOURCE — {item.title}» (кнопка «Открыть sta.sh», на sta.sh — Ctrl+F по названию).
              </li>
              <li>Цена {settingsQ.data?.exclusive_price ?? "—"}, тип продажи и topic — по разделу «Продажа и публикация».</li>
              <li>Сверьте описание и mature-флаги, подтвердите публикацию.</li>
              <li>Вернитесь на карточку и нажмите «Продажа оформлена».</li>
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            {item.listing_status !== "listed" && (
              <Button size="sm" variant="outline" onClick={() => act.mutate(() => updateItem(item.id, { listing_status: "pending", listing_error: null }))}>
                Повторить листинг
              </Button>
            )}
            {item.listing_status !== "listed" && (
              <Button size="sm" onClick={() => act.mutate(() => updateItem(item.id, { listing_status: "listed", listing_error: null }))}>
                Продажа оформлена
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <a href="https://sta.sh/" target="_blank" rel="noreferrer">Открыть sta.sh</a>
            </Button>
            {item.listing_status !== "manual" && item.listing_status !== "listed" && (
              <Button size="sm" variant="ghost" onClick={() => act.mutate(() => updateItem(item.id, { listing_status: "manual" }))}>
                Отменить авто
              </Button>
            )}
          </div>
        </div>
      )}
      {item.original_local_path && <p className="break-all text-[11px] text-muted-foreground">Оригинал на ПК: {item.original_local_path}</p>}
      {item.deviation_url && (
        <a href={item.deviation_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          Открыть работу на DeviantArt
        </a>
      )}
      {act.isPending && <Loader2 className="h-4 w-4 animate-spin" />}

      <CensorEditor
        src={src}
        open={editor}
        onOpenChange={setEditor}
        watermark={series.watermark ? `#${item.exclusive_number ?? ""}` : ""}
        onSaveTemplate={async (preset, style) => {
          await saveSettings({ censor_preset: preset as never, censor_style: style });
          qc.invalidateQueries({ queryKey: ["user-settings"] });
          toast.success("Шаблон цензуры сохранён");
        }}
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

const LISTING: Record<string, string> = {
  pending: "ждёт",
  in_progress: "оформляется на ПК",
  listed: "выставлено",
  failed: "ошибка",
  manual: "у вас: листинг в браузере",
};

function Pipeline({ item }: { item: SeriesItem }) {
  const order = ["selected", "upscaling", "upscaled", "preview_ready", "publishing", "draft", "published"];
  const idx = order.indexOf(item.status);
  if (idx < 0) return null;
  const steps = [
    { t: "Апскейл", done: idx >= 2 },
    { t: "Цензура", done: idx >= 3 || !!item.censored_preview_path },
    { t: "Опубликовано", done: item.status === "published" },
    { t: "Оригинал", done: !!item.source_stash_item_id },
    { t: "Листинг", done: item.listing_status === "listed" },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((s) => (
        <span
          key={s.t}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${s.done ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
        >
          {s.done ? "✓ " : ""}
          {s.t}
        </span>
      ))}
    </div>
  );
}
