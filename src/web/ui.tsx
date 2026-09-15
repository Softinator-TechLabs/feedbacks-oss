import React, { useEffect, useState, type ReactNode } from "react";
import { errorText } from "./api.js";
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice" role="status">
      {children}
    </p>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(work: () => Promise<void>, success = "") {
    const form = document.activeElement?.closest("form");
    const editVersion = form?.dataset.editVersion;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      // Only the submitted, unchanged draft is clean. A failed request or typing
      // while it was in flight must keep the navigation warning.
      if (form && form.dataset.editVersion === editVersion) delete form.dataset.unsaved;
      setNotice(success);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, run, setError };
}
export function ActionState({ action }: { action: ReturnType<typeof useAction> }) {
  return (
    <>
      <ErrorNotice error={action.error} />
      {action.notice && <Notice>{action.notice}</Notice>}
    </>
  );
}
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], poll = false) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await load();
        if (alive) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (alive) setError(errorText(e));
      } finally {
        pending = false;
      }
    }
    // Refresh authoritative data without unmounting form fields and their drafts.
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = poll ? setInterval(visible, 15000) : undefined;
    if (poll) document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, deps);
  return { data, setData, error };
}
export function Loading() {
  return (
    <p className="loading" role="status">
      Loading…
    </p>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  let safe = false;
  try {
    safe = ["http:", "https:"].includes(new URL(href).protocol);
  } catch {}
  return safe ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}
export function Secret({
  value,
  label = "Copy this secret now. It is only shown once.",
}: {
  value: string;
  label?: string;
}) {
  const a = useAction();
  return (
    <section className="secret">
      <p>{label}</p>
      <textarea readOnly aria-label={label} value={value} />
      <button onClick={() => a.run(() => navigator.clipboard.writeText(value), "Copied")}>
        Copy
      </button>
      <ActionState action={a} />
    </section>
  );
}
export function ConfirmButton({
  children,
  onConfirm,
  disabled = false,
}: {
  children: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="actions">
      <button
        type="button"
        className="danger"
        disabled={disabled}
        onClick={() => {
          setConfirm(false);
          onConfirm();
        }}
      >
        Confirm {children}
      </button>
      <button type="button" onClick={() => setConfirm(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button type="button" disabled={disabled} onClick={() => setConfirm(true)}>
      {children}
    </button>
  );
}
