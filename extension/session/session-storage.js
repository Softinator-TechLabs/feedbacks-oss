// Keep large DOM baselines outside chrome.storage.local's 10 MiB quota.
// Events are append-only while recording; stopping rewrites the sorted timeline.
export function createSessionStorage({ indexedDB = globalThis.indexedDB } = {}) {
  let opening;
  function database() {
    if (!opening)
      opening = new Promise((resolve, reject) => {
        if (!indexedDB) return reject(new Error("Recording storage is unavailable"));
        const request = indexedDB.open("feedbacks-session-capture", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("state");
          request.result.createObjectStore("events", { keyPath: "seq" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("Recording storage is blocked by another window"));
      });
    return opening;
  }
  async function transaction(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["state", "events"], mode);
      let result;
      let failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(failure || tx.error || new Error("Recording storage write failed"));
      const fail = (error) => {
        failure = error;
        tx.abort();
      };
      try {
        action(
          tx.objectStore("state"),
          tx.objectStore("events"),
          (value) => {
            result = value;
          },
          fail,
        );
      } catch (error) {
        fail(error);
      }
    });
  }
  return {
    get(key) {
      return transaction("readonly", (states, events, done) => {
        const stateRequest = states.get(key);
        const eventsRequest = events.getAll();
        eventsRequest.onsuccess = () => {
          const stored = stateRequest.result;
          if (!stored) return done({});
          const { eventCount: _, value } = stored;
          if (value.recording) value.recording.events = eventsRequest.result;
          done({ [key]: value });
        };
      });
    },
    set(values) {
      return transaction("readwrite", (states, events, done, fail) => {
        for (const [key, value] of Object.entries(values)) {
          const request = states.get(key);
          request.onsuccess = () => {
            try {
              const previous = request.result;
              const timeline = value.recording?.events || [];
              const rewrite =
                !value.active ||
                !previous ||
                previous.value.recording?.id !== value.recording?.id ||
                previous.eventCount > timeline.length;
              if (rewrite) events.clear();
              for (let i = rewrite ? 0 : previous.eventCount; i < timeline.length; i++)
                events.put(timeline[i]);
              const metadata = {
                ...value,
                ...(value.recording
                  ? { recording: { ...value.recording, events: undefined } }
                  : {}),
              };
              states.put({ value: metadata, eventCount: timeline.length }, key);
              done(undefined);
            } catch (error) {
              fail(error);
            }
          };
        }
      });
    },
    remove(key) {
      return transaction("readwrite", (states, events) => {
        states.delete(key);
        events.clear();
      });
    },
  };
}
