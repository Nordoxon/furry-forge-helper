import { get, set, del, keys, createStore } from "idb-keyval";

const itemStore = createStore("gallery-db", "items");
const handleStore = createStore("gallery-handles-db", "handles");
const collectionStore = createStore("gallery-collections-db", "collections");
const tagStore = createStore("gallery-tags-db", "tags");

export type FileItem = {
  id: string;
  name: string;
  path: string;
  type: string;
  size: number;
  addedAt: number;
  tagIds: string[];
  collectionIds: string[];
};

/** @deprecated alias kept for older imports — use FileItem */
export type GalleryItem = FileItem;

export type Tag = {
  id: string;
  name: string;
  createdAt: number;
};

export type Collection = {
  id: string;
  name: string;
  fileIds: string[];
  createdAt: number;
};

// ─── ids ────────────────────────────────────────────────────────────────
function rid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── handles ────────────────────────────────────────────────────────────
export async function saveHandle(id: string, handle: FileSystemFileHandle) {
  await set(id, handle, handleStore);
}
export async function getHandle(id: string): Promise<FileSystemFileHandle | undefined> {
  return get(id, handleStore);
}
export async function verifyPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission: (o: { mode: string }) => Promise<PermissionState>;
  };
  const opts = { mode: "read" };
  if ((await h.queryPermission(opts)) === "granted") return true;
  return (await h.requestPermission(opts)) === "granted";
}

// ─── tags ───────────────────────────────────────────────────────────────
export async function getAllTags(): Promise<Tag[]> {
  const ks = await keys(tagStore);
  const tags = await Promise.all(ks.map((k) => get(k as string, tagStore)));
  return (tags.filter(Boolean) as Tag[]).sort((a, b) => a.name.localeCompare(b.name));
}
export async function getTag(id: string): Promise<Tag | undefined> {
  return get(id, tagStore);
}
async function saveTag(tag: Tag) {
  await set(tag.id, tag, tagStore);
}
function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, " ");
}
export async function ensureTagByName(rawName: string): Promise<Tag> {
  const name = normalizeTagName(rawName);
  if (!name) throw new Error("Empty tag name");
  const all = await getAllTags();
  const existing = all.find((t) => t.name === name);
  if (existing) return existing;
  const tag: Tag = { id: rid("tag"), name, createdAt: Date.now() };
  await saveTag(tag);
  return tag;
}
export async function createTag(name: string): Promise<Tag> {
  return ensureTagByName(name);
}
export async function renameTag(id: string, newName: string): Promise<Tag | undefined> {
  const tag = await getTag(id);
  if (!tag) return;
  const name = normalizeTagName(newName);
  if (!name) return tag;
  // if another tag with this name already exists, merge into it
  const all = await getAllTags();
  const dup = all.find((t) => t.name === name && t.id !== id);
  if (dup) {
    // reassign all files from `id` to `dup.id`, then delete `id`
    const items = await getAllItemsRaw();
    await Promise.all(
      items
        .filter((i) => i.tagIds.includes(id))
        .map((i) =>
          saveItem({
            ...i,
            tagIds: Array.from(new Set(i.tagIds.map((t) => (t === id ? dup.id : t)))),
          }),
        ),
    );
    await del(id, tagStore);
    return dup;
  }
  const next = { ...tag, name };
  await saveTag(next);
  return next;
}
export async function deleteTag(id: string) {
  const items = await getAllItemsRaw();
  await Promise.all(
    items
      .filter((i) => i.tagIds.includes(id))
      .map((i) => saveItem({ ...i, tagIds: i.tagIds.filter((t) => t !== id) })),
  );
  await del(id, tagStore);
}
export async function assignTag(fileId: string, tagId: string) {
  const item = await getItem(fileId);
  if (!item || item.tagIds.includes(tagId)) return;
  await saveItem({ ...item, tagIds: [...item.tagIds, tagId] });
}
export async function unassignTag(fileId: string, tagId: string) {
  const item = await getItem(fileId);
  if (!item) return;
  await saveItem({ ...item, tagIds: item.tagIds.filter((t) => t !== tagId) });
}
export async function renameFile(id: string, name: string) {
  const item = await getItem(id);
  if (!item) return;
  const next = name.trim();
  if (!next || next === item.name) return;
  await saveItem({ ...item, name: next });
}

// ─── files ──────────────────────────────────────────────────────────────
type RawFile = Partial<FileItem> & {
  id: string;
  // legacy
  tags?: string[];
};

async function getAllItemsRaw(): Promise<FileItem[]> {
  const ks = await keys(itemStore);
  const items = await Promise.all(ks.map((k) => get(k as string, itemStore)));
  return items.filter(Boolean) as FileItem[];
}

export async function saveItem(item: FileItem) {
  await set(item.id, item, itemStore);
}
export async function getItem(id: string): Promise<FileItem | undefined> {
  return get(id, itemStore);
}
export async function deleteItem(id: string) {
  await del(id, itemStore);
  await del(id, handleStore);
  const cols = await getAllCollections();
  await Promise.all(
    cols
      .filter((c) => c.fileIds.includes(id))
      .map((c) => saveCollection({ ...c, fileIds: c.fileIds.filter((x) => x !== id) })),
  );
}

/** Loads all items and runs a one-time migration for pre-v3 records. */
export async function getAllItems(): Promise<FileItem[]> {
  const ks = await keys(itemStore);
  const raws = (await Promise.all(ks.map((k) => get(k as string, itemStore)))) as RawFile[];
  const migrated: FileItem[] = [];
  const collections = await getAllCollections();
  const collectionByFile = new Map<string, string[]>();
  collections.forEach((c) => c.fileIds.forEach((fid) => {
    const arr = collectionByFile.get(fid) ?? [];
    arr.push(c.id);
    collectionByFile.set(fid, arr);
  }));

  for (const raw of raws.filter(Boolean) as RawFile[]) {
    const needsMigration =
      !Array.isArray(raw.tagIds) ||
      !Array.isArray(raw.collectionIds) ||
      Array.isArray(raw.tags);

    let tagIds = Array.isArray(raw.tagIds) ? raw.tagIds : [];
    if (Array.isArray(raw.tags) && raw.tags.length) {
      const tags = await Promise.all(raw.tags.map((n) => ensureTagByName(n).catch(() => null)));
      tagIds = Array.from(new Set([...tagIds, ...tags.filter(Boolean).map((t) => (t as Tag).id)]));
    }
    const collectionIds = Array.isArray(raw.collectionIds)
      ? raw.collectionIds
      : collectionByFile.get(raw.id) ?? [];

    const item: FileItem = {
      id: raw.id,
      name: raw.name ?? "",
      path: raw.path ?? "",
      type: raw.type ?? "image/*",
      size: raw.size ?? 0,
      addedAt: raw.addedAt ?? Date.now(),
      tagIds,
      collectionIds,
    };
    if (needsMigration) await saveItem(item);
    migrated.push(item);
  }
  return migrated.sort((a, b) => b.addedAt - a.addedAt);
}

export async function clearAll() {
  for (const s of [itemStore, handleStore, collectionStore, tagStore]) {
    const ks = await keys(s);
    await Promise.all(ks.map((k) => del(k as string, s)));
  }
}

// ─── collections ────────────────────────────────────────────────────────
export async function saveCollection(c: Collection) {
  await set(c.id, c, collectionStore);
}
export async function getAllCollections(): Promise<Collection[]> {
  const ks = await keys(collectionStore);
  const items = await Promise.all(ks.map((k) => get(k as string, collectionStore)));
  return (items.filter(Boolean) as Collection[]).sort((a, b) => b.createdAt - a.createdAt);
}
export async function getCollection(id: string): Promise<Collection | undefined> {
  return get(id, collectionStore);
}
export async function createCollection(name: string): Promise<Collection> {
  const c: Collection = {
    id: rid("col"),
    name: name.trim() || "Untitled",
    fileIds: [],
    createdAt: Date.now(),
  };
  await saveCollection(c);
  return c;
}
export async function renameCollection(id: string, name: string): Promise<Collection | undefined> {
  const c = await getCollection(id);
  if (!c) return;
  const next = { ...c, name: name.trim() || c.name };
  await saveCollection(next);
  return next;
}
export async function deleteCollection(id: string) {
  // strip from files' collectionIds
  const items = await getAllItemsRaw();
  await Promise.all(
    items
      .filter((i) => i.collectionIds.includes(id))
      .map((i) => saveItem({ ...i, collectionIds: i.collectionIds.filter((x) => x !== id) })),
  );
  await del(id, collectionStore);
}
export async function addFileToCollection(collectionId: string, fileId: string) {
  const [c, f] = await Promise.all([getCollection(collectionId), getItem(fileId)]);
  if (!c || !f) return;
  if (!c.fileIds.includes(fileId)) await saveCollection({ ...c, fileIds: [...c.fileIds, fileId] });
  if (!f.collectionIds.includes(collectionId))
    await saveItem({ ...f, collectionIds: [...f.collectionIds, collectionId] });
}
export async function removeFileFromCollection(collectionId: string, fileId: string) {
  const [c, f] = await Promise.all([getCollection(collectionId), getItem(fileId)]);
  if (c) await saveCollection({ ...c, fileIds: c.fileIds.filter((x) => x !== fileId) });
  if (f) await saveItem({ ...f, collectionIds: f.collectionIds.filter((x) => x !== collectionId) });
}
export async function toggleItemInCollection(collectionId: string, fileId: string) {
  const c = await getCollection(collectionId);
  if (!c) return;
  if (c.fileIds.includes(fileId)) await removeFileFromCollection(collectionId, fileId);
  else await addFileToCollection(collectionId, fileId);
  return getCollection(collectionId);
}
