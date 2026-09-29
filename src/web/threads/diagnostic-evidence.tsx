import React, { useEffect, useRef, useState } from "react";
import { ApiError, api, errorText } from "../api.js";
import { ErrorNotice } from "../ui.js";
import type { DiagnosticFile } from "../../shared/screenshot-diagnostics.js";
import type { DiagnosticStats } from "../../shared/screenshot-diagnostics.js";

export type DiagnosticEvidenceSummary = {
  id: string;
  threadId: string;
  projectId: string;
  status: "pending" | "complete" | "expired";
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  totalBytes: number;
  domBytes?: number;
  stats?: DiagnosticStats;
  fileCount: number;
  coverage: Record<string, "complete" | "partial" | "unavailable" | "stopped">;
};

type Description = {
  evidence: DiagnosticEvidenceSummary;
  coverage?: Record<
    string,
    { status: string; observedCount: number; capturedBytes: number; reasons: string[] }
  >;
  files: DiagnosticFile[];
  total: number;
  nextOffset: number | null;
};

type Preview = { fileId: string; text: string; binary: boolean; error: string };
const PREVIEW_BYTES = 4096;
const PREVIEW_CHARS = 2048;
const FILES_PER_PAGE = 20;

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
  if (bytes >= 1024) return `${Number((bytes / 1024).toFixed(1))} KiB`;
  return `${bytes} B`;
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}

function captureFacts(item: DiagnosticEvidenceSummary) {
  const unknown = "unavailable";
  const start = new Date(item.startedAt).toLocaleString();
  const end = item.endedAt ? new Date(item.endedAt).toLocaleString() : unknown;
  const dom =
    item.domBytes === undefined
      ? unknown
      : `${size(item.domBytes)} (${item.domBytes.toLocaleString()} bytes)`;
  const stats = item.stats;
  return [
    `Capture window ${start} → ${end}`,
    `DOM ${dom}`,
    stats
      ? `Console ${stats.consoleCount.toLocaleString()} (${stats.errorCount.toLocaleString()} errors)`
      : `Console / errors ${unknown}`,
    `HTTP requests ${stats ? stats.httpRequestCount.toLocaleString() : unknown}`,
    `Response bodies ${stats ? `${stats.responseBodyCount.toLocaleString()} of ${stats.responseCount.toLocaleString()} responses` : unknown}`,
  ].join(" · ");
}

function accessError(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403))
    return "You no longer have access to these diagnostics. Refresh the thread or ask for access.";
  return errorText(error);
}

export function DiagnosticEvidencePanel({
  threadId,
  summaries,
  totalCount = summaries.length,
}: {
  threadId: string;
  summaries: DiagnosticEvidenceSummary[];
  totalCount?: number;
}) {
  const [listed, setListed] = useState<{
    items: DiagnosticEvidenceSummary[];
    nextOffset: number | null;
  } | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [description, setDescription] = useState<Description | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const serial = useRef(0);
  const visible = listed?.items ?? summaries;
  const selected = visible.find((item) => item.id === selectedId);

  async function loadList() {
    if (listing || (listed && listed.nextOffset === null)) return;
    setListing(true);
    setListError("");
    try {
      const offset = listed?.nextOffset ?? 0;
      const page = await api<{
        items: DiagnosticEvidenceSummary[];
        nextOffset: number | null;
      }>("diagnostics.list", { threadId, offset, limit: FILES_PER_PAGE });
      setListed({
        items: listed ? [...listed.items, ...page.items] : page.items,
        nextOffset: page.nextOffset,
      });
    } catch (error) {
      setListError(accessError(error));
    } finally {
      setListing(false);
    }
  }

  async function loadPreview(file: DiagnosticFile, request: number) {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const sample = await api<{
        encoding: "utf8" | "base64";
        text?: string;
        byteLength: number;
      }>("diagnostics.read", {
        evidenceId: selectedId,
        fileId: file.fileId,
        sequence: 0,
        byteOffset: 0,
        limitBytes: PREVIEW_BYTES,
      });
      if (request !== serial.current) return;
      setPreview({
        fileId: file.fileId,
        text:
          sample.encoding === "utf8" ? (sample.text ?? "").slice(0, PREVIEW_CHARS) : "",
        binary: sample.encoding !== "utf8",
        error: "",
      });
    } catch (error) {
      if (request === serial.current)
        setPreview({
          fileId: file.fileId,
          text: "",
          binary: false,
          error: accessError(error),
        });
    } finally {
      if (request === serial.current) setPreviewLoading(false);
    }
  }

  useEffect(() => {
    const request = ++serial.current;
    setDescription(null);
    setPreview(null);
    setDetailError("");
    setDownloadError("");
    if (
      !selectedId ||
      !selected ||
      selected.status !== "complete" ||
      selected.threadId !== threadId
    ) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<Description>("diagnostics.describe", {
      evidenceId: selectedId,
      offset: 0,
      limit: FILES_PER_PAGE,
    })
      .then(async (value) => {
        if (request !== serial.current) return;
        setDescription(value);
        const first = value.files.find((file) => file.chunks.length > 0);
        if (first) await loadPreview(first, request);
      })
      .catch((error: unknown) => {
        if (request === serial.current) setDetailError(accessError(error));
      })
      .finally(() => {
        if (request === serial.current) setLoading(false);
      });
    return () => {
      serial.current++;
    };
  }, [threadId, selectedId]);

  async function loadMore() {
    if (description?.nextOffset === null || !description || loading) return;
    const request = serial.current;
    setLoading(true);
    setDetailError("");
    try {
      const next = await api<Description>("diagnostics.describe", {
        evidenceId: selectedId,
        offset: description.nextOffset,
        limit: FILES_PER_PAGE,
      });
      if (request === serial.current)
        setDescription({ ...next, files: [...description.files, ...next.files] });
    } catch (error) {
      if (request === serial.current) setDetailError(accessError(error));
    } finally {
      if (request === serial.current) setLoading(false);
    }
  }

  async function download() {
    if (!selected || selected.status !== "complete" || downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const large = selected.totalBytes > 32 * 1024 * 1024;
      const picker = (
        window as typeof window & {
          showSaveFilePicker?: (options: unknown) => Promise<{
            createWritable: () => Promise<WritableStream<Uint8Array>>;
          }>;
        }
      ).showSaveFilePicker;
      const handle =
        large && picker
          ? await picker({
              suggestedName: `feedbacks-diagnostics-${selected.id}.tar.gz`,
              types: [
                {
                  description: "Compressed diagnostic archive",
                  accept: { "application/gzip": [".gz"] },
                },
              ],
            })
          : null;
      if (large && !handle) {
        // The server streams this attachment. Let the browser own the file when
        // its File System Access picker is unavailable instead of buffering 256 MiB.
        await api<Description>("diagnostics.describe", {
          evidenceId: selected.id,
          offset: 0,
          limit: 1,
        });
        const link = document.createElement("a");
        link.href = `/api/diagnostics/${encodeURIComponent(selected.id)}/archive`;
        link.target = "_blank";
        link.rel = "noopener";
        link.click();
        return;
      }
      const response = await fetch(
        `/api/diagnostics/${encodeURIComponent(selected.id)}/archive`,
        {
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
        },
      );
      if (response.status === 401 || response.status === 403)
        throw new ApiError("FORBIDDEN", "Diagnostic access denied", response.status);
      if (
        !response.ok ||
        !response.body ||
        response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
          "application/gzip"
      )
        throw new Error("Download failed. Try again.");
      if (handle) {
        await response.body.pipeTo(await handle.createWritable());
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `feedbacks-diagnostics-${selected.id}.tar.gz`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setDownloadError(accessError(error));
    } finally {
      setDownloading(false);
    }
  }

  if (totalCount === 0) return null;
  return (
    <section
      className="section diagnostic-evidence"
      aria-labelledby="diagnostic-evidence-title"
    >
      <h2 id="diagnostic-evidence-title">Captured diagnostics</h2>
      <p className="muted">
        Private page evidence. Coverage shows what the browser could capture.
      </p>
      <ul className="diagnostic-evidence-list">
        {visible.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={item.id === selectedId}
              onClick={() => setSelectedId(item.id === selectedId ? "" : item.id)}
            >
              View captured diagnostics · {label(item.status)} · {size(item.totalBytes)}
            </button>
            <span className="diagnostic-evidence-meta">
              {item.fileCount} {item.fileCount === 1 ? "file" : "files"} ·{" "}
              {Object.entries(item.coverage)
                .map(([channel, status]) => `${label(channel)} ${label(status)}`)
                .join(" · ")}
            </span>
            <span className="diagnostic-evidence-facts">{captureFacts(item)}</span>
          </li>
        ))}
      </ul>
      {((listed?.nextOffset !== null && listed !== null) ||
        (!listed && totalCount > summaries.length)) && (
        <button type="button" onClick={() => void loadList()} disabled={listing}>
          {listing ? "Loading diagnostics…" : "Show older diagnostics"}
        </button>
      )}
      <ErrorNotice error={listError} />
      {selected && (
        <div className="diagnostic-evidence-detail">
          <p>
            Captured{" "}
            <time dateTime={selected.startedAt}>
              {new Date(selected.startedAt).toLocaleString()}
            </time>
            {selected.status !== "complete" &&
              ` · ${label(selected.status)} evidence cannot be previewed yet.`}
          </p>
          {selected.status === "complete" && (
            <>
              <button type="button" onClick={download} disabled={downloading}>
                {downloading ? "Preparing download…" : "Download captured diagnostics"}
              </button>
              <ErrorNotice error={downloadError} />
              <ErrorNotice error={detailError} />
              {loading && <p role="status">Loading diagnostic details…</p>}
              {description && (
                <>
                  {description.coverage && (
                    <dl className="diagnostic-evidence-coverage">
                      {Object.entries(description.coverage).map(([channel, coverage]) => (
                        <div key={channel}>
                          <dt>{label(channel)}</dt>
                          <dd>
                            {label(coverage.status)} · {coverage.observedCount} observed ·{" "}
                            {size(coverage.capturedBytes)}
                            {coverage.reasons.length > 0 &&
                              ` · ${coverage.reasons.map(label).join(", ")}`}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <ul className="diagnostic-evidence-files">
                    {description.files.map((file) => (
                      <li key={file.fileId}>
                        <span>
                          {label(file.kind)} · {size(file.byteLength)} · {file.mimeType}
                        </span>
                        {file.chunks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void loadPreview(file, serial.current)}
                            disabled={previewLoading}
                          >
                            Preview
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {description.nextOffset !== null && (
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      disabled={loading}
                    >
                      Show more files
                    </button>
                  )}
                  {preview && (
                    <div className="diagnostic-evidence-preview">
                      <h3>Sample · first {size(PREVIEW_BYTES)} only</h3>
                      <ErrorNotice error={preview.error} />
                      {preview.binary ? (
                        <p>Binary data is available in the download.</p>
                      ) : (
                        <pre>{preview.text}</pre>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
