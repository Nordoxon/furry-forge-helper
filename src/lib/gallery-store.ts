import { get, set, del, keys, createStore } from "idb-keyval";

const store = createStore("gallery-db", "items");

export type GalleryItem = {
  id: string;
  name: string;
  path: string;
  tags: string[];
  size: number;
  type: string;
  addedAt: number;
};

export type Collection = {
  id: string;
  name: string;
  fileIds: string[];
  createdAt: number;
};

// FileSystemFileHandle storage (separate store keeps tag updates lightweight)
const handleStore = createStore("gallery-handles-db", "handles");
const collectionStore = createStore("gallery-collections-db", "collections");

export async function saveItem(item: GalleryItem) {
  await set(item.id, item, store);
}
export async function saveHandle(id: string, handle: FileSystemFileHandle) {
  await set(id, handle, handleStore);
}
export async function getHandle(id: string): Promise<FileSystemFileHandle | undefined> {
  return get(id, handleStore);
}
export async function getAllItems(): Promise<GalleryItem[]> {
  const ks = await keys(store);
  const items = await Promise.all(ks.map((k) => get(k as string, store)));
  return (items.filter(Boolean) as GalleryItem[]).sort((a, b) => b.addedAt - a.addedAt);
}
export async function deleteItem(id: string) {
  await del(id, store);
  await del(id, handleStore);
  // also strip from collections
  const cols = await getAllCollections();
  await Promise.all(
    cols
      .filter((c) => c.fileIds.includes(id))
      .map((c) => saveCollection({ ...c, fileIds: c.fileIds.filter((x) => x !== id) })),
  );
}
export async function clearAll() {
  const ks = await keys(store);
  await Promise.all(ks.map((k) => del(k as string, store)));
  const hk = await keys(handleStore);
  await Promise.all(hk.map((k) => del(k as string, handleStore)));
  const ck = await keys(collectionStore);
  await Promise.all(ck.map((k) => del(k as string, collectionStore)));
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

// ---- Collections ----
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
export async function deleteCollection(id: string) {
  await del(id, collectionStore);
}
export async function createCollection(name: string): Promise<Collection> {
  const c: Collection = {
    id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "Untitled",
    fileIds: [],
    createdAt: Date.now(),
  };
  await saveCollection(c);
  return c;
}
export async function toggleItemInCollection(collectionId: string, itemId: string) {
  const c = await getCollection(collectionId);
  if (!c) return;
  const has = c.fileIds.includes(itemId);
  const next = {
    ...c,
    fileIds: has ? c.fileIds.filter((x) => x !== itemId) : [...c.fileIds, itemId],
  };
  await saveCollection(next);
  return next;
}
