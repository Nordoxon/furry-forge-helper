import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type Character,
  createCharacter,
  deleteCharacter,
  getAllCharacters,
  saveCharacter,
} from "@/lib/pipeline-store";

export const Route = createFileRoute("/characters")({
  head: () => ({ meta: [{ title: "Персонажи — Furry Content Manager" }] }),
  component: CharactersPage,
});

function CharactersPage() {
  const [chars, setChars] = useState<Character[]>([]);
  const reload = useCallback(async () => setChars(await getAllCharacters()), []);
  useEffect(() => {
    reload();
  }, [reload]);

  const [draft, setDraft] = useState({
    name: "",
    species: "",
    baseTags: "",
    titleTemplate: "{character} — {scene} #{n}",
    notes: "",
  });

  async function add() {
    if (!draft.name.trim()) return;
    await createCharacter({
      name: draft.name.trim(),
      species: draft.species.trim(),
      baseTags: draft.baseTags.split(",").map((s) => s.trim()).filter(Boolean),
      titleTemplate: draft.titleTemplate.trim() || "{character} — {scene} #{n}",
      notes: draft.notes.trim(),
    });
    setDraft({ name: "", species: "", baseTags: "", titleTemplate: "{character} — {scene} #{n}", notes: "" });
    await reload();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Персонажи</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Базовые теги и шаблон названия применяются автоматически на шаге «Теги».
        </p>
      </div>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Новый персонаж</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Имя" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input placeholder="Вид (fox, wolf, …)" value={draft.species} onChange={(e) => setDraft({ ...draft, species: e.target.value })} />
          <Input className="sm:col-span-2" placeholder="Базовые теги через запятую" value={draft.baseTags} onChange={(e) => setDraft({ ...draft, baseTags: e.target.value })} />
          <Input className="sm:col-span-2" placeholder="Шаблон названия" value={draft.titleTemplate} onChange={(e) => setDraft({ ...draft, titleTemplate: e.target.value })} />
          <Textarea className="sm:col-span-2" placeholder="Заметки" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={add}><Plus /> Добавить</Button>
        </div>
      </section>

      <section className="space-y-3">
        {chars.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            <UserRound className="mx-auto mb-2 h-6 w-6" />
            Персонажей пока нет
          </div>
        )}
        {chars.map((c) => (
          <CharacterRow key={c.id} character={c} onChanged={reload} />
        ))}
      </section>
    </div>
  );
}

function CharacterRow({ character, onChanged }: { character: Character; onChanged: () => void }) {
  const [c, setC] = useState(character);
  useEffect(() => setC(character), [character]);

  async function save() {
    await saveCharacter(c);
    onChanged();
  }
  async function remove() {
    if (!confirm(`Удалить персонажа «${character.name}»?`)) return;
    await deleteCharacter(character.id);
    onChanged();
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        <Input value={c.species} onChange={(e) => setC({ ...c, species: e.target.value })} />
        <Input
          className="sm:col-span-2"
          value={c.baseTags.join(", ")}
          onChange={(e) =>
            setC({ ...c, baseTags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
          }
        />
        <Input className="sm:col-span-2" value={c.titleTemplate} onChange={(e) => setC({ ...c, titleTemplate: e.target.value })} />
        <Textarea className="sm:col-span-2" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={remove}><Trash2 /> Удалить</Button>
        <Button variant="outline" onClick={save}><Save /> Сохранить</Button>
      </div>
    </div>
  );
}
