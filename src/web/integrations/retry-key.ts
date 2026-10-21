import { useRef } from "react";
import { api } from "../api.js";
import type { inputSchemas } from "../../shared/contracts.js";
import type { z } from "zod";
type ExternalWrite =
  | "trackers.oauthComplete"
  | "trackers.save"
  | "trackers.create"
  | "trackers.link"
  | "trackers.comment"
  | "trackers.sync";
/** Reuse the same reservation after a lost HTTP response; retire it only after acknowledgement. */
export function useTrackerWrite() {
  const keys = useRef(new Map<string, string>());
  return async <N extends ExternalWrite>(
    name: N,
    input: Omit<z.input<(typeof inputSchemas)[N]>, "idempotencyKey">,
  ) => {
    const fingerprint = JSON.stringify([name, input]);
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    const result = await api(name, { ...input, idempotencyKey: key } as any);
    keys.current.delete(fingerprint);
    return result;
  };
}
