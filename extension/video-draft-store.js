const DATABASE = "feedbacks-video-drafts";
const STORE = "drafts";

async function withStore(mode, callback) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = callback(tx.objectStore(STORE));
      let value;
      request.onsuccess = () => (value = request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function putVideoDraft(id, draft) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || !(draft?.blob instanceof Blob))
    throw Error("Invalid local video draft.");
  await withStore("readwrite", (store) => store.put(draft, id));
}

export async function getVideoDraft(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  return (await withStore("readonly", (store) => store.get(id))) || null;
}

export async function deleteVideoDraft(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return;
  await withStore("readwrite", (store) => store.delete(id));
}
