const DATABASE = "feedbacks-capture-pages";
const STORE = "pages";

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      let result;
      request.onsuccess = () => (result = request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const key = (draftId, index, kind) => `${draftId}:${index}:${kind}`;

export async function putPage(draftId, index, kind, blob) {
  if (!(blob instanceof Blob)) throw Error("Capture page must be an image blob.");
  await transaction("readwrite", (store) => store.put(blob, key(draftId, index, kind)));
}

export async function getPage(draftId, index, kind = "source") {
  return transaction("readonly", (store) => store.get(key(draftId, index, kind)));
}

export async function deletePage(draftId, index, kind = "source") {
  await transaction("readwrite", (store) => store.delete(key(draftId, index, kind)));
}

export async function deleteDraftPages(draftId) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.openKeyCursor(
        IDBKeyRange.bound(`${draftId}:`, `${draftId}:\uffff`),
      );
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function pageDataUrl(blob) {
  if (!blob) throw Error("This screenshot is no longer available in this browser.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
