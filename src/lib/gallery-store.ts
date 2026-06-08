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

// FileSystemFileHandle storage (separate store keeps tag updates lightweight)
const handleStore = createStore("gallery-handles-db", "handles");

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
}
export async function clearAll() {
  const ks = await keys(store);
  await Promise.all(ks.map((k) => del(k as string, store)));
  const hk = await keys(handleStore);
  await Promise.all(hk.map((k) => del(k as string, handleStore)));
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
