import React, { useSyncExternalStore } from "react";
import { date, relativeDate } from "./api.js";

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function HumanTime({ at }: { at: string }) {
  const current = useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
  const exact = date(at);
  return (
    <time dateTime={at} title={exact} aria-label={exact}>
      {relativeDate(at, current)}
    </time>
  );
}
