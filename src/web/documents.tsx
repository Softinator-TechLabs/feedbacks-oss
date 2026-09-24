import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, date, uid, type Project, type ReviewDocument, type Thread } from "./api.js";
import { pointFromClient, percentPoint } from "./document-coordinates.js";
import {
  ActionState,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  useAction,
  useLoad,
} from "./ui.js";
import "./documents.css";

type Marker = {
  threadId: string;
  body: string;
  page: number;
  x: number;
  y: number;
  state: string;
};

function bytesLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function Documents({ project }: { project: Project }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(
    () => api<{ items: ReviewDocument[] }>("documents.list", { projectId: project.id }),
    [project.id, version],
  );
  const action = useAction();
  const file = useRef<HTMLInputElement>(null);
  const retry = useRef<{ signature: string; key: string } | undefined>(undefined);
  return (
    <section className="document-library">
      <div className="page-heading">
        <div>
          <h1>Documents</h1>
          <p>Review a PDF or image together.</p>
        </div>
      </div>
      {project.permissions.canMaintain && (
        <form
          className="document-upload"
          onSubmit={(event) => {
            event.preventDefault();
            const selected = file.current?.files?.[0];
            if (!selected) {
              action.setError("Choose a PDF or image first");
              return;
            }
            if (selected.size > 8 * 1024 * 1024) {
              action.setError("Choose a file smaller than 8 MB");
              return;
            }
            const signature = `${selected.name}:${selected.size}:${selected.lastModified}`;
            if (retry.current?.signature !== signature)
              retry.current = { signature, key: uid() };
            void action.run(async () => {
              await api("documents.upload", {
                projectId: project.id,
                name: selected.name,
                fileBase64: await readBase64(selected),
                idempotencyKey: retry.current!.key,
              });
              if (file.current) file.current.value = "";
              retry.current = undefined;
              setVersion((value) => value + 1);
            }, "Document added to this project.");
          }}
        >
          <Field
            label="Add a document"
            hint="PDF, PNG, JPEG or WebP. Up to 8 MB; PDFs up to 25 pages."
          >
            <input
              ref={file}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              required
            />
          </Field>
          <button className="primary" disabled={action.busy}>
            {action.busy ? "Adding…" : "Add document"}
          </button>
          <ActionState action={action} />
        </form>
      )}
      <ErrorNotice error={error} />
      {!data && !error && <Loading />}
      {data?.items.length === 0 && (
        <Empty title="No documents yet">Add a PDF or image to review it here.</Empty>
      )}
      {data && data.items.length > 0 && (
        <ul className="document-list">
          {data.items.map((item) => (
            <li key={item.id}>
              <a href={`/projects/${project.id}/documents/${item.id}`}>{item.name}</a>
              <span>
                {item.kind === "pdf"
                  ? `${item.pageCount} ${item.pageCount === 1 ? "page" : "pages"}`
                  : "Image"}{" "}
                · {bytesLabel(item.bytes)} · {date(item.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PdfPage({
  document,
  page,
  onSelect,
}: {
  document: ReviewDocument;
  page: number;
  onSelect: (point: { x: number; y: number }) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    let alive = true;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    void import("pdfjs-dist")
      .then(({ GlobalWorkerOptions, getDocument }) => {
        if (!alive) return;
        GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        task = getDocument({
          url: document.url,
          withCredentials: true,
          isEvalSupported: false,
          disableAutoFetch: true,
        });
        return task.promise;
      })
      .then((loaded) => {
        if (alive && loaded) setPdf(loaded);
      })
      .catch(() => {
        if (alive)
          setError("This PDF could not be opened. Download it to inspect the source.");
      });
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [document.url]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setRendered(false);
    void pdf
      .getPage(page)
      .then((pdfPage) => {
        if (!active || !canvas.current) return;
        const initial = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({
          scale: Math.min(2, 1100 / initial.width),
        });
        canvas.current.width = Math.ceil(viewport.width);
        canvas.current.height = Math.ceil(viewport.height);
        task = pdfPage.render({
          canvasContext: canvas.current.getContext("2d")!,
          viewport,
        });
        return task.promise;
      })
      .then(() => {
        if (active) setRendered(true);
      })
      .catch((failure) => {
        if (active && failure?.name !== "RenderingCancelledException")
          setError("This page could not be drawn. Try another page or download the PDF.");
      });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <>
      <ErrorNotice error={error} />
      {!rendered && !error && <Loading />}
      <canvas
        ref={canvas}
        aria-label={`Page ${page} of ${document.name}`}
        onClick={(event) =>
          onSelect(
            pointFromClient(
              event.currentTarget.getBoundingClientRect(),
              event.clientX,
              event.clientY,
            ),
          )
        }
      />
    </>
  );
}

export function DocumentViewer({
  project,
  documentId,
}: {
  project: Project;
  documentId: string;
}) {
  const [page, setPage] = useState(
    () => Number(new URLSearchParams(location.search).get("page")) || 1,
  );
  const [point, setPoint] = useState<{ x: number; y: number }>();
  const [xPercent, setXPercent] = useState("");
  const [yPercent, setYPercent] = useState("");
  const [version, setVersion] = useState(0);
  const retry = useRef<{ signature: string; key: string } | undefined>(undefined);
  const { data: document, error } = useLoad(
    () => api<ReviewDocument>("documents.get", { documentId }),
    [documentId],
  );
  const { data: threads, error: threadsError } = useLoad(
    () => api<{ items: Marker[] }>("documents.threads", { documentId }),
    [documentId, version],
  );
  const action = useAction();
  const select = (next: { x: number; y: number }) => {
    setPoint(next);
    setXPercent(String(Math.round(next.x * 1000) / 10));
    setYPercent(String(Math.round(next.y * 1000) / 10));
  };
  if (error) return <ErrorNotice error={error} />;
  if (!document) return <Loading />;
  const currentPage = Math.min(Math.max(1, page), document.pageCount);
  const markers = threads?.items.filter((item) => item.page === currentPage) ?? [];
  return (
    <section className="document-review">
      <a href={`/projects/${project.id}/documents`}>← All documents</a>
      <div className="page-heading">
        <div>
          <h1>{document.name}</h1>
          <p>
            {document.kind === "pdf"
              ? `${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"}`
              : "Image"}{" "}
            · {bytesLabel(document.bytes)}
          </p>
        </div>
        <a className="button" href={document.url} download>
          Download source
        </a>
      </div>
      {document.kind === "pdf" && (
        <nav className="document-pages" aria-label="Document pages">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => {
              setPage(currentPage - 1);
              setPoint(undefined);
            }}
          >
            Previous page
          </button>
          <span>
            Page {currentPage} of {document.pageCount}
          </span>
          <button
            type="button"
            disabled={currentPage >= document.pageCount}
            onClick={() => {
              setPage(currentPage + 1);
              setPoint(undefined);
            }}
          >
            Next page
          </button>
        </nav>
      )}
      <p className="muted">
        Click the document to place a point, or enter percentages below.
      </p>
      <div className="document-layout">
        <div className="document-stage-wrap">
          <div className="document-stage">
            {document.kind === "pdf" ? (
              <PdfPage document={document} page={currentPage} onSelect={select} />
            ) : (
              <img
                src={document.url}
                alt={document.name}
                onClick={(event) =>
                  select(
                    pointFromClient(
                      event.currentTarget.getBoundingClientRect(),
                      event.clientX,
                      event.clientY,
                    ),
                  )
                }
              />
            )}
            {markers.map((marker, index) => (
              <a
                key={marker.threadId}
                className="document-marker"
                href={`/threads/${marker.threadId}`}
                style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                aria-label={`Open feedback ${index + 1}: ${marker.body.slice(0, 100)}`}
                title={marker.body}
              >
                {index + 1}
              </a>
            ))}
            {point && (
              <span
                className="document-selected-point"
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        <aside className="document-sidebar">
          {project.permissions.canWrite && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                let position;
                try {
                  position = percentPoint(xPercent, yPercent);
                } catch (failure) {
                  action.setError((failure as Error).message);
                  return;
                }
                const body = String(new FormData(event.currentTarget).get("body") ?? "");
                const input = {
                  projectId: project.id,
                  body,
                  document: { documentId, page: currentPage, ...position },
                };
                const signature = JSON.stringify(input);
                if (retry.current?.signature !== signature)
                  retry.current = { signature, key: uid() };
                void (async () => {
                  let thread: Thread | undefined;
                  const saved = await action.run(async () => {
                    thread = await api<Thread>("threads.create", {
                      ...input,
                      idempotencyKey: retry.current!.key,
                    });
                  });
                  if (saved && thread) location.href = `/threads/${thread.id}`;
                })();
              }}
            >
              <h2>Leave feedback</h2>
              <div className="document-position">
                <Field label="Across (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={xPercent}
                    onChange={(event) => {
                      const value = event.target.value;
                      setXPercent(value);
                      try {
                        setPoint(percentPoint(value, yPercent));
                      } catch {
                        setPoint(undefined);
                      }
                    }}
                    required
                  />
                </Field>
                <Field label="Down (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={yPercent}
                    onChange={(event) => {
                      const value = event.target.value;
                      setYPercent(value);
                      try {
                        setPoint(percentPoint(xPercent, value));
                      } catch {
                        setPoint(undefined);
                      }
                    }}
                    required
                  />
                </Field>
              </div>
              <Field label="Comment">
                <textarea
                  name="body"
                  rows={5}
                  maxLength={12000}
                  required
                  placeholder="What should change here?"
                />
              </Field>
              <button className="primary" disabled={action.busy}>
                {action.busy ? "Posting…" : "Post feedback"}
              </button>
              <ActionState action={action} />
            </form>
          )}
          <div className="document-discussions">
            <h2>Discussion on this page</h2>
            <ErrorNotice error={threadsError} />
            {markers.length === 0 && !threadsError && (
              <p className="muted">No points on this page yet.</p>
            )}
            <ol>
              {markers.map((marker) => (
                <li key={marker.threadId}>
                  <a href={`/threads/${marker.threadId}`}>{marker.body}</a>
                  <small>{marker.state.replaceAll("_", " ")}</small>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </section>
  );
}
