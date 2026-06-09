import { get, set, del, keys, createStore } from "idb-keyval";

const releaseStore = createStore("pipeline-releases-db", "releases");
const characterStore = createStore("pipeline-characters-db", "characters");
const settingsStore = createStore("pipeline-settings-db", "settings");

export type Step =
  | "import"
  | "triage"
  | "character"
  | "tags"
  | "bundle"
  | "publish"
  | "done";

export const STEPS: Step[] = [
  "import",
  "triage",
  "character",
  "tags",
  "bundle",
  "publish",
];

export const STEP_LABELS: Record<Step, string> = {
  import: "Импорт",
  triage: "Отбор",
  character: "Персонаж",
  tags: "Теги",
  bundle: "Пак",
  publish: "Публикация",
  done: "Готово",
};

export type Character = {
  id: string;
  name: string;
  species: string;
  baseTags: string[];
  titleTemplate: string; // "{character} — {scene} #{n}"
  notes: string;
  createdAt: number;
};

export type Release = {
  id: string;
  step: Step;
  fileIds: string[];
  starredIds: string[];
  rejectedIds: string[];
  characterId?: string;
  sceneChips: string[];
  customTags: string[];
  title: string;
  coverId?: string;
  packName: string;
  packDescription: string;
  releaseNumber: number;
  createdAt: number;
  completedAt?: number;
};

const ACTIVE_KEY = "active_release_id";
const COUNTER_KEY = "release_counter";

function rid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── settings ───────────────────────────────────────────────────────────
export async function getActiveReleaseId(): Promise<string | undefined> {
  return get(ACTIVE_KEY, settingsStore);
}
export async function setActiveReleaseId(id: string | undefined) {
  if (id) await set(ACTIVE_KEY, id, settingsStore);
  else await del(ACTIVE_KEY, settingsStore);
}
async function nextReleaseNumber(): Promise<number> {
  const n = ((await get(COUNTER_KEY, settingsStore)) as number | undefined) ?? 0;
  const next = n + 1;
  await set(COUNTER_KEY, next, settingsStore);
  return next;
}

// ─── releases ───────────────────────────────────────────────────────────
export async function createRelease(fileIds: string[]): Promise<Release> {
  const number = await nextReleaseNumber();
  const r: Release = {
    id: rid("rel"),
    step: "triage",
    fileIds,
    starredIds: [],
    rejectedIds: [],
    sceneChips: [],
    customTags: [],
    title: "",
    packName: `Release #${number}`,
    packDescription: "",
    releaseNumber: number,
    createdAt: Date.now(),
  };
  await saveRelease(r);
  await setActiveReleaseId(r.id);
  return r;
}
export async function saveRelease(r: Release) {
  await set(r.id, r, releaseStore);
}
export async function getRelease(id: string): Promise<Release | undefined> {
  return get(id, releaseStore);
}
export async function deleteRelease(id: string) {
  await del(id, releaseStore);
  const active = await getActiveReleaseId();
  if (active === id) await setActiveReleaseId(undefined);
}
export async function getAllReleases(): Promise<Release[]> {
  const ks = await keys(releaseStore);
  const rs = await Promise.all(ks.map((k) => get(k as string, releaseStore)));
  return (rs.filter(Boolean) as Release[]).sort((a, b) => b.createdAt - a.createdAt);
}

// ─── characters ─────────────────────────────────────────────────────────
export async function saveCharacter(c: Character) {
  await set(c.id, c, characterStore);
}
export async function createCharacter(input: Omit<Character, "id" | "createdAt">): Promise<Character> {
  const c: Character = { ...input, id: rid("ch"), createdAt: Date.now() };
  await saveCharacter(c);
  return c;
}
export async function getCharacter(id: string): Promise<Character | undefined> {
  return get(id, characterStore);
}
export async function getAllCharacters(): Promise<Character[]> {
  const ks = await keys(characterStore);
  const cs = await Promise.all(ks.map((k) => get(k as string, characterStore)));
  return (cs.filter(Boolean) as Character[]).sort((a, b) => a.name.localeCompare(b.name));
}
export async function deleteCharacter(id: string) {
  await del(id, characterStore);
}

// ─── scene presets ──────────────────────────────────────────────────────
export const SCENE_GROUPS: { key: string; label: string; chips: string[] }[] = [
  { key: "time", label: "Время", chips: ["morning", "day", "sunset", "night"] },
  { key: "pose", label: "Поза", chips: ["portrait", "full body", "sitting", "action"] },
  { key: "setting", label: "Сцена", chips: ["forest", "city", "indoor", "beach", "studio"] },
  { key: "mood", label: "Настроение", chips: ["calm", "playful", "dramatic", "soft"] },
];

export function buildTitle(template: string, character: string, scene: string, n: number): string {
  const num = String(n).padStart(3, "0");
  return (template || "{character} — {scene} #{n}")
    .replaceAll("{character}", character || "Untitled")
    .replaceAll("{scene}", scene || "set")
    .replaceAll("{n}", num);
}
