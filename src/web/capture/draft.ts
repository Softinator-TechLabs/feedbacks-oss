import type { AppCapture } from "../../shared/app-capture.js";
import type { NativeDiagnosticReport } from "../../shared/native-diagnostics.js";

export type CaptureDraft = {
  projectId: string;
  body: string;
  appCapture: AppCapture;
  nativeDiagnostics?: NativeDiagnosticReport;
  imageBase64: string;
  createKey: string;
  uploadKey: string;
  thread?: { id: string; revision: number };
};

// Only approved pixels are persisted, scoped to the signed-in user and project.
async function draftStore<T>(
  key: string,
  action: "get" | "put" | "delete",
  value?: CaptureDraft,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("feedbacks-app-capture", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        Error("Local draft storage is unavailable. Allow browser storage and try again."),
      );
    request.onblocked = () => reject(Error("Close other capture pages and try again."));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("drafts");
      const request =
        action === "get"
          ? store.get(key)
          : action === "put"
            ? store.put(value, key)
            : store.delete(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () =>
        reject(
          Error(
            "Could not save the local capture draft. Free browser storage and retry.",
          ),
        );
    });
  } finally {
    db.close();
  }
}
export const readCaptureDraft = (key: string) =>
  draftStore<CaptureDraft | undefined>(key, "get");
export const saveCaptureDraft = (key: string, value: CaptureDraft) =>
  draftStore(key, "put", value);
export const deleteCaptureDraft = (key: string) => draftStore(key, "delete");
