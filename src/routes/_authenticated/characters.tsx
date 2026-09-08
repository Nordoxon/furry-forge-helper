import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
  gallery_folder: "",
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

  function openNew() {
    setForm({ ...BLANK });
    setEditing("new");
  }
  function openEdit(c: CharacterRow) {
    setForm({
      name: c.name,
      species: c.species,
      base_tags: c.base_tags.join(", "),
      title_template: c.title_template,
      description_template: c.description_template,
      gallery_folder: c.gallery_folder,
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
      gallery_folder: form.gallery_folder.trim(),
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
          list.map((c) => (
            <div
              key={c.id}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
            >
              <button onClick={() => openEdit(c)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium">
                  {c.name}
                  {c.is_default && <span className="ml-2 text-[10px] text-primary">по умолчанию</span>}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {c.base_tags.length > 0 ? c.base_tags.map((t) => `#${t}`).join(" ") : "Без базовых тегов"}
                </p>
              </button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/packs" search={{ character: c.id }}>
                  <Package className="mr-1 h-4 w-4" /> Паки
                </Link>
              </Button>
            </div>
          ))

        )}

        {editing !== null && (
          <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4">
            <Field label="Имя">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Вид">
              <Input
                value={form.species}
                placeholder="fox, wolf…"
                onChange={(e) => setForm({ ...form, species: e.target.value })}
              />
            </Field>
            <Field label="Базовые теги (через запятую)">
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
            <Field label="Папка галереи на DeviantArt">
              <Input
                value={form.gallery_folder}
                onChange={(e) => setForm({ ...form, gallery_folder: e.target.value })}
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
            <Field label="Стиль персонажа" hint="имя стиля из styles.csv на компьютере">
              <Input
                value={form.gen_style}
                placeholder="Lucario"
                onChange={(e) => setForm({ ...form, gen_style: e.target.value })}
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
