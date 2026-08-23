import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { BottomNav } from "@/components/bottom-nav";
import {
  MATURE_CLASSES,
  RESOLUTIONS,
  deleteTemplate,
  fetchTemplates,
  type TemplateRow,
} from "@/lib/templates";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({
    meta: [
      { title: "Шаблоны публикации — Furry Content Manager" },
      {
        name: "description",
        content:
          "Готовые наборы тегов и опций DeviantArt: зрелость, лицензия, категория, водяной знак — применяются к изображению при отборе.",
      },
      { property: "og:title", content: "Шаблоны публикации — Furry Content Manager" },
      {
        property: "og:description",
        content: "Один тап — и изображение уходит с нужными тегами и опциями DeviantArt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemplatesPage,
});

const BLANK = {
  name: "",
  tags: "",
  description_template: "",
  gallery_folder: "",
  is_mature: true,
  mature_level: "moderate",
  mature_classification: [] as string[],
  is_ai_generated: true,
  noai: false,
  allow_comments: true,
  allow_free_download: false,
  add_watermark: false,
  display_resolution: 0,
  license_cc: false,
  license_commercial: false,
  license_modify: "no",
  category_path: "",
  auto_publish: false,
  is_downloadable: false,
  download_price: 0,
  is_default: false,
};

type Form = typeof BLANK;

function TemplatesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>({ ...BLANK });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openNew() {
    setForm({ ...BLANK });
    setEditing("new");
  }

  function openEdit(t: TemplateRow) {
    setForm({
      name: t.name,
      tags: t.tags.join(", "),
      description_template: t.description_template,
      gallery_folder: t.gallery_folder,
      is_mature: t.is_mature,
      mature_level: t.mature_level,
      mature_classification: t.mature_classification,
      is_ai_generated: t.is_ai_generated,
      noai: t.noai,
      allow_comments: t.allow_comments,
      allow_free_download: t.allow_free_download,
      add_watermark: t.add_watermark,
      display_resolution: t.display_resolution,
      license_cc: t.license_cc,
      license_commercial: t.license_commercial,
      license_modify: t.license_modify,
      category_path: t.category_path,
      auto_publish: t.auto_publish,
      is_downloadable: t.is_downloadable,
      download_price: t.download_price,
      is_default: t.is_default,
    });
    setEditing(t.id);
  }

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        user_id: userData.user!.id,
        name: form.name.trim(),
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        description_template: form.description_template,
        gallery_folder: form.gallery_folder.trim(),
        is_mature: form.is_mature,
        mature_level: form.mature_level,
        mature_classification: form.mature_classification,
        is_ai_generated: form.is_ai_generated,
        noai: form.noai,
        allow_comments: form.allow_comments,
        allow_free_download: form.allow_free_download,
        add_watermark: form.add_watermark,
        display_resolution: form.display_resolution,
        license_cc: form.license_cc,
        license_commercial: form.license_commercial,
        license_modify: form.license_modify,
        category_path: form.category_path.trim(),
        auto_publish: form.auto_publish,
        is_downloadable: form.is_downloadable,
        download_price: Math.max(0, Math.round(Number(form.download_price) || 0)),
        is_default: form.is_default,
      };
      const res =
        editing === "new"
          ? await supabase.from("publish_templates").insert(payload)
          : await supabase.from("publish_templates").update(payload).eq("id", editing!);
      if (res.error) throw res.error;
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Шаблон сохранён");
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteTemplate(id);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["templates"] });
    } catch (e) {
      toast.error(`Не удалось удалить: ${(e as Error).message}`);
    }
  }

  const list = q.data ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold leading-tight">Шаблоны</h1>
            <p className="text-xs text-muted-foreground">Теги и опции DeviantArt</p>
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
            <LayoutTemplate className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 font-display text-lg font-semibold">Шаблонов пока нет</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Создайте шаблон с тегами и опциями DeviantArt — при отборе достаточно будет выбрать его,
              и агент загрузит изображение уже с этими настройками.
            </p>
            <Button className="mt-5" onClick={openNew}>
              <Plus className="mr-1 h-4 w-4" /> Создать шаблон
            </Button>
          </div>
        ) : (
          list.map((t) => (
            <button
              key={t.id}
              onClick={() => openEdit(t)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                editing === t.id ? "border-primary" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t.name}</span>
                {t.is_default && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                    по умолчанию
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {t.tags.length ? t.tags.join(", ") : "без тегов"}
                {t.gallery_folder ? ` · папка: ${t.gallery_folder}` : ""}
                {t.is_mature ? " · 18+" : ""}
              </p>
            </button>
          ))
        )}

        {editing !== null && (
          <div className="space-y-4 rounded-2xl border border-border p-4">
            <Field label="Название шаблона">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>

            <Field label="Теги" hint="Через запятую, до 30 штук — как в поле Tags на DeviantArt">
              <Textarea
                rows={3}
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                placeholder="furry, anthro, aiart, digitalart"
              />
            </Field>

            <Field
              label="Описание"
              hint="Можно использовать {name}, {character}, {species}, {n}, {filename}"
            >
              <Textarea
                rows={3}
                value={form.description_template}
                onChange={(e) => set("description_template", e.target.value)}
              />
            </Field>

            <Field label="Папка галереи" hint="Оставьте пустым, чтобы выбирать папку при отборе">
              <Input
                value={form.gallery_folder}
                onChange={(e) => set("gallery_folder", e.target.value)}
              />
            </Field>

            <Field label="Категория" hint="Путь категории DA, например digitalart/paintings/other">
              <Input
                value={form.category_path}
                onChange={(e) => set("category_path", e.target.value)}
              />
            </Field>

            <Toggle
              label="Материал 18+ (Mature Content)"
              checked={form.is_mature}
              onChange={(v) => set("is_mature", v)}
            />

            {form.is_mature && (
              <>
                <Field label="Уровень зрелости">
                  <div className="flex gap-2">
                    {[
                      { v: "moderate", l: "Moderate" },
                      { v: "strict", l: "Strict" },
                    ].map((o) => (
                      <Chip
                        key={o.v}
                        active={form.mature_level === o.v}
                        onClick={() => set("mature_level", o.v)}
                      >
                        {o.l}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field label="Причина">
                  <div className="flex flex-wrap gap-2">
                    {MATURE_CLASSES.map((c) => {
                      const active = form.mature_classification.includes(c.value);
                      return (
                        <Chip
                          key={c.value}
                          active={active}
                          onClick={() =>
                            set(
                              "mature_classification",
                              active
                                ? form.mature_classification.filter((x) => x !== c.value)
                                : [...form.mature_classification, c.value],
                            )
                          }
                        >
                          {c.label}
                        </Chip>
                      );
                    })}
                  </div>
                </Field>
              </>
            )}

            <Toggle
              label="Отметить как созданное с помощью ИИ"
              checked={form.is_ai_generated}
              onChange={(v) => set("is_ai_generated", v)}
            />
            <Toggle
              label="Запретить использование для обучения ИИ (NoAI)"
              checked={form.noai}
              onChange={(v) => set("noai", v)}
            />
            <Toggle
              label="Разрешить комментарии"
              checked={form.allow_comments}
              onChange={(v) => set("allow_comments", v)}
            />
            <Toggle
              label="Разрешить свободное скачивание"
              checked={form.allow_free_download}
              onChange={(v) => set("allow_free_download", v)}
            />
            <Toggle
              label="Добавлять водяной знак"
              checked={form.add_watermark}
              onChange={(v) => set("add_watermark", v)}
            />

            <Field label="Ограничение размера показа">
              <div className="flex flex-wrap gap-2">
                {RESOLUTIONS.map((r) => (
                  <Chip
                    key={r.value}
                    active={form.display_resolution === r.value}
                    onClick={() => set("display_resolution", r.value)}
                  >
                    {r.label}
                  </Chip>
                ))}
              </div>
            </Field>

            <Toggle
              label="Лицензия Creative Commons"
              checked={form.license_cc}
              onChange={(v) => set("license_cc", v)}
            />
            {form.license_cc && (
              <>
                <Toggle
                  label="Коммерческое использование"
                  checked={form.license_commercial}
                  onChange={(v) => set("license_commercial", v)}
                />
                <Field label="Изменение работы">
                  <div className="flex gap-2">
                    {[
                      { v: "yes", l: "Разрешено" },
                      { v: "share", l: "С той же лицензией" },
                      { v: "no", l: "Запрещено" },
                    ].map((o) => (
                      <Chip
                        key={o.v}
                        active={form.license_modify === o.v}
                        onClick={() => set("license_modify", o.v)}
                      >
                        {o.l}
                      </Chip>
                    ))}
                  </div>
                </Field>
              </>
            )}

            <Toggle
              label="Публиковать в галерею автоматически"
              checked={form.auto_publish}
              onChange={(v) => set("auto_publish", v)}
            />
            <Toggle
              label="Платное скачивание (Points)"
              checked={form.is_downloadable}
              onChange={(v) => set("is_downloadable", v)}
            />
            {form.is_downloadable && (
              <Field label="Цена скачивания, баллов (Points)">
                <Input
                  type="number"
                  min={0}
                  value={form.download_price}
                  onChange={(e) => set("download_price", Number(e.target.value))}
                />
              </Field>
            )}

            <Toggle
              label="Шаблон по умолчанию"
              checked={form.is_default}
              onChange={(v) => set("is_default", v)}
            />

            <div className="flex gap-2 pt-1">
              <Button onClick={save} disabled={busy} className="flex-1">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
