import { useEffect, useRef, useState } from "react";
import { api, uid, type Project, type Thread } from "../api.js";
import { navigate } from "../navigation.js";
import { ActionState, ConfirmButton, Field, Loading, useAction } from "../ui.js";
import {
  approvedImage,
  captureWindow,
  importCapture,
  type CaptureImage,
  type Mask,
  type CapturePoint,
} from "./image.js";
import {
  readCaptureDraft,
  saveCaptureDraft,
  deleteCaptureDraft,
  type CaptureDraft,
} from "./draft.js";
import { appCaptureSchema, type AppCapture } from "../../shared/app-capture.js";
import "./capture.css";
import { CaptureEditor } from "./editor.js";

export function AppCapturePage({
  project,
  userId,
}: {
  project: Project;
  userId: string;
}) {
  const key = `${userId}:${project.id}`;
  const action = useAction();
  const form = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(true);
  const [image, setImage] = useState<CaptureImage>();
  const [masks, setMasks] = useState<Mask[]>([]);
  const [points, setPoints] = useState<CapturePoint[]>([]);
  const [appName, setAppName] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [platform, setPlatform] = useState<AppCapture["platform"]>("other");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<CaptureDraft>();
  const pendingRef = useRef<CaptureDraft | undefined>(undefined);
  const captureAbort = useRef<AbortController | undefined>(undefined);
  const [complete, setComplete] = useState<string>();
  const canCapture = !!navigator.mediaDevices?.getDisplayMedia;
  useEffect(() => {
    let live = true;
    void readCaptureDraft(key)
      .then((draft) => {
        if (!live || !draft || draft.projectId !== project.id) return;
        pendingRef.current = draft;
        setPending(draft);
        setAppName(draft.appCapture.appName);
        setAppVersion(draft.appCapture.appVersion ?? "");
        setPlatform(draft.appCapture.platform);
        setBody(draft.body);
        setImage({
          dataUrl: `data:image/webp;base64,${draft.imageBase64}`,
          ...draft.appCapture,
        });
      })
      .catch((error) => {
        if (live) action.setError(error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      captureAbort.current?.abort();
    };
  }, [key]);
  const replace = (next: CaptureImage) => {
    setImage(next);
    setMasks([]);
    setPoints([]);
    if (form.current) form.current.dataset.unsaved = "true";
  };
  const submit = async (saved?: CaptureDraft) => {
    const draft = saved ?? pendingRef.current;
    if (!draft) throw Error("The capture draft is unavailable. Choose an image again.");
    await saveCaptureDraft(key, draft);
    if (!draft.thread) {
      const thread = await api<Thread>("threads.create", {
        projectId: draft.projectId,
        body: draft.body,
        appCapture: draft.appCapture,
        idempotencyKey: draft.createKey,
      });
      draft.thread = { id: thread.id, revision: thread.revision };
      await saveCaptureDraft(key, draft);
      setPending({ ...draft });
    }
    await api("assets.upload", {
      threadId: draft.thread.id,
      revision: draft.thread.revision,
      imageBase64: draft.imageBase64,
      rendition: "screenshot",
      filename: "app-capture.webp",
      markings: draft.appCapture.points.map((point, index) => ({
        tool: "point",
        bounds: { x: point.x, y: point.y, width: 0, height: 0 },
        endpoints: [{ x: point.x, y: point.y }],
        number: index + 1,
        annotationId: point.id,
      })),
      idempotencyKey: draft.uploadKey,
    });
    setComplete(draft.thread.id);
    if (form.current) delete form.current.dataset.unsaved;
    await deleteCaptureDraft(key).catch(() => undefined);
    navigate(`/threads/${draft.thread.id}`);
  };
  const locked = action.busy || !!pending;
  if (!project.permissions.canWrite)
    return (
      <p role="alert">Project write access is required to send an app screenshot.</p>
    );
  if (loading) return <Loading />;
  return (
    <section className="app-capture">
      <h1>App screenshot</h1>
      <p>
        Capture a window or import a screenshot. Check the image, hide private details and
        send feedback.
      </p>
      {complete ? (
        <p role="status">
          Feedback sent. <a href={`/threads/${complete}`}>Open feedback</a>
        </p>
      ) : (
        <form
          ref={form}
          data-unsaved={image ? "true" : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (action.busy) return;
            void action.run(async () => {
              if (!pendingRef.current) {
                if (!image) throw Error("Capture a window or import a screenshot first.");
                if (!body.trim() || !appName.trim())
                  throw Error("Enter the app name and feedback before sending.");
                if (points.some((point) => !point.body.trim()))
                  throw Error("Write a note for each point, or remove it.");
                const draft: CaptureDraft = {
                  projectId: project.id,
                  body: body.trim(),
                  appCapture: {
                    appName: appName.trim(),
                    appVersion: appVersion.trim() || undefined,
                    platform,
                    method: image.method,
                    surface: image.surface,
                    capturedAt: image.capturedAt,
                    width: image.width,
                    height: image.height,
                    points,
                  },
                  imageBase64: await approvedImage(image, masks, points),
                  createKey: uid(),
                  uploadKey: uid(),
                };
                draft.appCapture = appCaptureSchema.parse(draft.appCapture);
                await saveCaptureDraft(key, draft);
                pendingRef.current = draft;
                setPending(draft);
              }
              await submit();
            });
          }}
        >
          {!pending && (
            <div className="app-capture-sources">
              {canCapture ? (
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      captureAbort.current = new AbortController();
                      try {
                        replace(await captureWindow(captureAbort.current.signal));
                      } catch (error) {
                        if (
                          error instanceof DOMException &&
                          error.name === "NotAllowedError"
                        )
                          throw Error(
                            "Capture was cancelled or denied. Try again or import a screenshot.",
                          );
                        throw error;
                      }
                    })
                  }
                >
                  Capture window
                </button>
              ) : (
                <p className="muted">
                  Window capture is unavailable in this browser. Import a screenshot
                  instead.
                </p>
              )}
              <Field label="Import screenshot">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={action.busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file)
                      void action.run(async () => replace(await importCapture(file)));
                  }}
                />
              </Field>
            </div>
          )}
          {image && (
            <>
              <div className="form-grid">
                <Field label="App name">
                  <input
                    value={appName}
                    onChange={(event) => setAppName(event.target.value)}
                    maxLength={120}
                    required
                    disabled={locked}
                  />
                </Field>
                <Field label="Platform">
                  <select
                    aria-label="Platform"
                    value={platform}
                    disabled={locked}
                    onChange={(event) =>
                      setPlatform(event.target.value as AppCapture["platform"])
                    }
                  >
                    <option value="other">Other / unknown</option>
                    <option value="windows">Windows</option>
                    <option value="macos">macOS</option>
                    <option value="linux">Ubuntu / Linux</option>
                    <option value="android">Android</option>
                    <option value="ios">iOS / iPadOS</option>
                  </select>
                </Field>
              </div>
              <CaptureEditor
                image={image}
                appName={appName}
                masks={masks}
                points={points}
                setMasks={setMasks}
                setPoints={setPoints}
                editable={!pending}
                locked={locked}
              />
              <Field label="Feedback">
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  required
                  maxLength={12000}
                  rows={4}
                  disabled={locked}
                />
              </Field>
              <details>
                <summary>App version (optional)</summary>
                <Field label="App version">
                  <input
                    value={appVersion}
                    onChange={(event) => setAppVersion(event.target.value)}
                    maxLength={80}
                    disabled={locked}
                  />
                </Field>
              </details>
              <p className="muted">
                Only the approved image, notes and app details are sent. Internal app logs
                and network traffic are not collected.
              </p>
              {pending && (
                <p role="status">
                  {pending.thread
                    ? "Feedback was created. Retry to finish its screenshot upload."
                    : "Your approved draft is saved locally. Retry sends the same feedback."}{" "}
                  {pending.thread && (
                    <a href={`/threads/${pending.thread.id}`}>Open existing feedback</a>
                  )}
                </p>
              )}
              {pending?.thread && action.errorCode === "CONFLICT" && (
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const latest = await api<Thread>("threads.get", {
                        threadId: pending.thread!.id,
                      });
                      const draft = {
                        ...pending,
                        thread: { id: latest.id, revision: latest.revision },
                        uploadKey: uid(),
                      };
                      await saveCaptureDraft(key, draft);
                      pendingRef.current = draft;
                      setPending(draft);
                    }, "Latest revision loaded. Review the existing feedback, then retry the screenshot.")
                  }
                >
                  Load latest feedback revision
                </button>
              )}
              <div className="form-end">
                <button className="primary" disabled={action.busy}>
                  {action.busy ? "Sending…" : pending ? "Retry Send" : "Send feedback"}
                </button>
                <ConfirmButton
                  disabled={action.busy}
                  onConfirm={() =>
                    void action.run(async () => {
                      await deleteCaptureDraft(key);
                      pendingRef.current = undefined;
                      setPending(undefined);
                      setImage(undefined);
                      setPoints([]);
                      setMasks([]);
                      if (form.current) delete form.current.dataset.unsaved;
                    })
                  }
                >
                  Discard local capture
                </ConfirmButton>
              </div>
            </>
          )}
          <ActionState action={action} />
        </form>
      )}
    </section>
  );
}
