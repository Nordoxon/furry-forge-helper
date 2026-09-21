import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, Package } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { BottomNav } from "@/components/bottom-nav";
import { fetchCharacters, type CharacterRow } from "@/lib/images";
import { fetchPromptDefaults, fetchSpeciesTags, tagsForSpecies } from "@/lib/defaults";
import { addGenStyle, deleteGenStyle, fetchGenStyles } from "@/lib/styles";
import { SearchableSelect } from "@/components/searchable-select";
import { toast } from "sonner";


export const Route = createFileRoute("/_authenticated/characters")({
  head: () => ({
    meta: [
      { title: "Персонажи — Furry Content Manager" },
      {
        name: "description",
        content: "Пресеты персонажей: базовые теги, шаблон названия, описание и папка галереи DeviantArt.",
      },
      { property: "og:title", content: "Персонажи — Furry Content Manager" },
      {
        property: "og:description",
        content: "Настройте шаблоны, чтобы названия, теги и описания подставлялись автоматически.",
      },
    ],
  }),
  component: CharactersPage,
});

const BLANK = {
  name: "",
  species: "",
  base_tags: "",
  title_template: "{character} #{n}",
  description_template: "",
  
  is_mature: false,
  is_default: false,
  sfw_prompt: "",
  nsfw_prompt: "",
  negative_prompt: "",
  prompt_approved: false,
  generation_enabled: true,
  gen_width: "832",
  gen_height: "1216",
  gen_cfg: "5",
  gen_steps: "28",
  gen_sampler: "Euler a",
  gen_batch_count: "100",
  gen_style: "",
};

function CharactersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["characters"], queryFn: fetchCharacters });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const defaults = useQuery({ queryKey: ["prompt-defaults"], queryFn: fetchPromptDefaults });
  const speciesTags = useQuery({ queryKey: ["species-tags"], queryFn: fetchSpeciesTags });
  const styles = useQuery({ queryKey: ["gen-styles"], queryFn: fetchGenStyles });

  // Сохранённые на сайте имена стилей + те, что уже стоят у персонажей
  const styleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of styles.data ?? []) set.add(s.name);
    for (const c of q.data ?? []) if (c.gen_style) set.add(c.gen_style);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [q.data, styles.data]);

  async function addStyle(name: string) {
    try {
      await addGenStyle(name);
      void qc.invalidateQueries({ queryKey: ["gen-styles"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeStyle(name: string) {
    try {
      await deleteGenStyle(name);
      if (form.gen_style === name) setForm((f) => ({ ...f, gen_style: "" }));
      void qc.invalidateQueries({ queryKey: ["gen-styles"] });
      toast.success(`Стиль «${name}» удалён`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }


  function openNew() {
    setForm({
      ...BLANK,
      sfw_prompt: defaults.data?.sfw_prompt ?? "",
      nsfw_prompt: defaults.data?.nsfw_prompt ?? "",
      negative_prompt: defaults.data?.negative_prompt ?? "",
    });
    setEditing("new");
  }

  /** Вид меняется — подставляем теги этого вида, не теряя уже написанные. */
  function changeSpecies(next: string) {
    const auto = tagsForSpecies(next, speciesTags.data ?? []);
    const current = form.base_tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const merged = [...current];
    for (const t of auto) if (!merged.includes(t)) merged.push(t);
    setForm({ ...form, species: next, base_tags: merged.join(", ") });
  }
  function openEdit(c: CharacterRow) {
    setForm({
      name: c.name,
      species: c.species,
      base_tags: c.base_tags.join(", "),
      title_template: c.title_template,
      description_template: c.description_template,
      
      is_mature: c.is_mature,
      is_default: c.is_default,
      sfw_prompt: c.sfw_prompt,
      nsfw_prompt: c.nsfw_prompt,
      negative_prompt: c.negative_prompt,
      prompt_approved: c.prompt_approved,
      generation_enabled: c.generation_enabled,
      gen_width: String(c.gen_width),
      gen_height: String(c.gen_height),
      gen_cfg: String(c.gen_cfg),
      gen_steps: String(c.gen_steps),
      gen_sampler: c.gen_sampler,
      gen_batch_count: String(c.gen_batch_count),
      gen_style: c.gen_style,
    });
    setEditing(c.id);
  }

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      user_id: userData.user!.id,
      name: form.name.trim(),
      species: form.species.trim(),
      base_tags: form.base_tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      title_template: form.title_template,
      description_template: form.description_template,
      
      is_mature: form.is_mature,
      is_default: form.is_default,
      sfw_prompt: form.sfw_prompt,
      nsfw_prompt: form.nsfw_prompt,
      negative_prompt: form.negative_prompt,
      prompt_approved: form.prompt_approved,
      generation_enabled: form.generation_enabled,
      gen_width: Number(form.gen_width) || 832,
      gen_height: Number(form.gen_height) || 1216,
      gen_cfg: Number(form.gen_cfg) || 5,
      gen_steps: Number(form.gen_steps) || 28,
      gen_sampler: form.gen_sampler.trim() || "Euler a",
      gen_batch_count: Number(form.gen_batch_count) || 100,
      gen_style: form.gen_style.trim(),
    };
    if (editing === "new") await supabase.from("characters").insert(payload);
    else if (editing) await supabase.from("characters").update(payload).eq("id", editing);
    setBusy(false);
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["characters"] });
  }

  async function remove(id: string) {
    await supabase.from("characters").delete().eq("id", id);
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["characters"] });
  }

  const list = q.data ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold leading-tight">Персонажи</h1>
            <p className="text-xs text-muted-foreground">Шаблоны названий и тегов</p>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Добавить
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-4 py-4">
        {q.isLoading ? (
          <div className="grid h-40 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 && editing === null ? (
          <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-center">
            <h2 className="font-display text-lg font-semibold">Ни одного персонажа</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Персонаж хранит базовые теги и шаблон названия — их получит каждое одобренное изображение.
            </p>
            <Button className="mt-5" onClick={openNew}>
              <Plus className="mr-1 h-4 w-4" /> Создать первого
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchableSelect
                value={selectedId}
                placeholder="Выберите персонажа"
                emptyText="Ничего не найдено"
                options={list.map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: c.is_default ? "по умолчанию" : undefined,
                }))}
                onChange={(id) => {
                  const c = list.find((x) => x.id === id);
                  if (c) {
                    rememberCharacter(c.id);
                    openEdit(c);
                  }
                }}
              />
            </div>
            <Button size="sm" variant="outline" className="shrink-0" asChild disabled={!selectedId}>
              <Link to="/packs" search={{ character: selectedId ?? undefined }}>
                <Package className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Паки</span>
              </Link>
            </Button>
          </div>
        )}

        {editing !== null && (
          <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4">
            <Field label="Имя">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Вид">
              <Input
                value={form.species}
                placeholder="pokemon, fox, wolf…"
                onChange={(e) => changeSpecies(e.target.value)}
              />
            </Field>
            <Field
              label="Базовые теги (через запятую)"
              hint="теги вида подставляются сами — их можно поправить"
            >
              <Input
                value={form.base_tags}
                placeholder="furry, digitalart, aiart"
                onChange={(e) => setForm({ ...form, base_tags: e.target.value })}
              />
            </Field>
            <Field label="Шаблон названия" hint="{character} {species} {n} {filename}">
              <Input
                value={form.title_template}
                onChange={(e) => setForm({ ...form, title_template: e.target.value })}
              />
            </Field>
            <Field label="Шаблон описания">
              <Textarea
                rows={3}
                value={form.description_template}
                onChange={(e) => setForm({ ...form, description_template: e.target.value })}
              />
            </Field>
            <Field label="Промпт для SFW" hint="его получит компьютер и запустит генерацию">
              <Textarea
                rows={4}
                value={form.sfw_prompt}
                placeholder="masterpiece, portrait, {character}…"
                onChange={(e) => setForm({ ...form, sfw_prompt: e.target.value })}
              />
            </Field>
            <Field label="Промпт для NSFW" hint="включится сам, когда SFW-этап закрыт">
              <Textarea
                rows={4}
                value={form.nsfw_prompt}
                onChange={(e) => setForm({ ...form, nsfw_prompt: e.target.value })}
              />
            </Field>
            <Field label="Негативный промпт" hint="один общий для SFW и NSFW">
              <Textarea
                rows={3}
                value={form.negative_prompt}
                placeholder="lowres, bad anatomy, blurry…"
                onChange={(e) => setForm({ ...form, negative_prompt: e.target.value })}
              />
            </Field>
            <Field label="Стиль персонажа" hint="имя стиля из styles.csv на компьютере">
              <StylePicker
                value={form.gen_style}
                options={styleOptions}
                onChange={(v) => setForm({ ...form, gen_style: v })}
                onAdd={(v) => void addStyle(v)}
                onDelete={(v) => void removeStyle(v)}
              />


            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Ширина">
                <Input
                  inputMode="numeric"
                  value={form.gen_width}
                  onChange={(e) => setForm({ ...form, gen_width: e.target.value })}
                />
              </Field>
              <Field label="Высота">
                <Input
                  inputMode="numeric"
                  value={form.gen_height}
                  onChange={(e) => setForm({ ...form, gen_height: e.target.value })}
                />
              </Field>
              <Field label="CFG">
                <Input
                  inputMode="decimal"
                  value={form.gen_cfg}
                  onChange={(e) => setForm({ ...form, gen_cfg: e.target.value })}
                />
              </Field>
              <Field label="Шаги">
                <Input
                  inputMode="numeric"
                  value={form.gen_steps}
                  onChange={(e) => setForm({ ...form, gen_steps: e.target.value })}
                />
              </Field>
              <Field label="Сэмплер">
                <Input
                  value={form.gen_sampler}
                  placeholder="Euler a"
                  onChange={(e) => setForm({ ...form, gen_sampler: e.target.value })}
                />
              </Field>
              <Field label="Кадров за запуск">
                <Input
                  inputMode="numeric"
                  value={form.gen_batch_count}
                  onChange={(e) => setForm({ ...form, gen_batch_count: e.target.value })}
                />
              </Field>
            </div>
            <label className="flex items-center justify-between">
              <span className="text-sm">Промпт подтверждён</span>
              <Switch
                checked={form.prompt_approved}
                onCheckedChange={(v) => setForm({ ...form, prompt_approved: v })}
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Разрешить генерацию на компьютере</span>
              <Switch
                checked={form.generation_enabled}
                onCheckedChange={(v) => setForm({ ...form, generation_enabled: v })}
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Контент 18+</span>
              <Switch
                checked={form.is_mature}
                onCheckedChange={(v) => setForm({ ...form, is_mature: v })}
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Выбирать по умолчанию</span>
              <Switch
                checked={form.is_default}
                onCheckedChange={(v) => setForm({ ...form, is_default: v })}
              />
            </label>

            <div className="flex gap-2 pt-1">
              <Button onClick={save} disabled={busy} className="flex-1">
                Сохранить
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Отмена
              </Button>
              {editing !== "new" && (
                <Button variant="ghost" size="icon" onClick={() => remove(editing)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Выбор стиля: выпадающий список с поиском, удалением и добавлением имени из styles.csv. */
function StylePicker({
  value,
  options,
  onChange,
  onAdd,
  onDelete,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onAdd: (v: string) => void;
  onDelete: (v: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const name = draft.trim();
    if (!name) return;
    onAdd(name);
    onChange(name);
    setDraft("");
    setManual(false);
  }

  return (
    <div className="space-y-2">
      <SearchableSelect
        value={value || "__none__"}
        placeholder="Без стиля"
        emptyText="Стиль не найден"
        options={[
          { value: "__none__", label: "Без стиля" },
          ...options.map((o) => ({ value: o, label: o })),
        ]}
        onChange={(v) => onChange(v === "__none__" ? "" : v)}
        onDelete={(v) => {
          if (v === "__none__") return;
          if (window.confirm(`Удалить стиль «${v}» из списка?`)) onDelete(v);
        }}
      />
      {manual ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={draft}
            placeholder="Имя из styles.csv"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
          />
          <Button type="button" onClick={commit}>
            Добавить
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => setManual(true)}>
          <Plus className="mr-1 h-4 w-4" /> Добавить имя из styles.csv
        </Button>
      )}
    </div>
  );
}
