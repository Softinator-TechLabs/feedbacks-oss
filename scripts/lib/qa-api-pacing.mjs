import { setTimeout } from "node:timers/promises";

// Disposable acceptance fixtures can generate a whole workday of requests in a
// minute. Space their real API dispatches below the unchanged 240/minute actor
// budget. This handler neither inspects credentials nor retries any request.
export function paceQaApi(handler) {
  const intervalMs = 275,
    maxPending = 24,
    now = () => performance.now();
  let tail = Promise.resolve(),
    nextAt = 0,
    pending = 0;
  const stats = { dispatched: 0, delayed: 0, cancelled: 0, overflow: 0, maxWaitMs: 0 };
  const reject = (res, code) => {
    if (res.destroyed) return;
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code, message: code } }));
  };
  const paced = (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/api/")) return handler(req, res);
    // Stay below the existing ten-second fixture fetch timeout. Excess load
    // fails visibly instead of accumulating an unbounded queue or replaying it.
    if (pending >= maxPending) {
      stats.overflow++;
      reject(res, "QA_API_PACING_CAPACITY");
      return;
    }
    pending++;
    const arrived = now();
    const request = tail.then(async () => {
      if (req.destroyed || res.destroyed) {
        stats.cancelled++;
        return;
      }
      const delay = Math.max(0, nextAt - now());
      if (delay) await setTimeout(delay);
      if (req.destroyed || res.destroyed) {
        stats.cancelled++;
        return;
      }
      nextAt = now() + intervalMs;
      const wait = now() - arrived;
      if (wait > 0) stats.delayed++;
      stats.maxWaitMs = Math.max(stats.maxWaitMs, Math.ceil(wait));
      stats.dispatched++;
      handler(req, res);
    });
    tail = request.catch(() => {});
    void request
      .catch(() => reject(res, "QA_API_PACING_FAILED"))
      .finally(() => pending--);
  };
  paced.stats = stats;
  return paced;
}
