import {
  combinedImageSize,
  combinedImageNeedsResize,
} from "../capture/combined-image.js";
import {
  putPage,
  getPage,
  deletePage,
  deleteDraftPages,
  pageDataUrl,
} from "../capture/page-store.js";
import {
  summarizeMarkings,
  pagePixelSize,
  continuousDraft,
  combinedMarkings,
  combinedSections,
} from "../capture/markings.js";
import { uploadDraftDiagnostics } from "../diagnostics/upload.js";

export function createSubmissionWorkflow({
  get,
  set,
  requireImageRevision,
  authenticated,
  diagnosticEvidenceStore,
  accountIdentity,
}) {
  let sending = false;
  async function combineApprovedPages(draft) {
    const indices = continuousDraft(draft).indices;
    let width = 0;
    let height = 0;
    for (const index of indices) {
      const blob = await getPage(draft.id, index, "approved");
      if (!blob) throw Error(`Approved screenshot ${index + 1} is missing.`);
      const bitmap = await createImageBitmap(blob);
      if (width && bitmap.width !== width) {
        bitmap.close();
        throw Error("Screenshot widths changed; send the ordered images separately.");
      }
      width = bitmap.width;
      height += bitmap.height;
      bitmap.close();
    }
    try {
      const output = combinedImageSize(width, height);
      const canvas = new OffscreenCanvas(output.width, output.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("Canvas is unavailable.");
      let sourceTop = 0;
      for (const index of indices) {
        const blob =
          (draft.combinedWithoutPins &&
            (await getPage(draft.id, index, "without-pins"))) ||
          (await getPage(draft.id, index, "approved"));
        const bitmap = await createImageBitmap(blob);
        const top = Math.round((sourceTop / height) * output.height);
        sourceTop += bitmap.height;
        const bottom = Math.round((sourceTop / height) * output.height);
        ctx.drawImage(bitmap, 0, top, output.width, bottom - top);
        bitmap.close();
      }
      let blob;
      for (const quality of [0.85, 0.7, 0.5]) {
        blob = await canvas.convertToBlob({ type: "image/webp", quality });
        if (blob.size <= 10 * 1024 * 1024) break;
      }
      if (!blob?.size || blob.size > 10 * 1024 * 1024)
        throw Error("Combined image exceeds the server's per-image size.");
      await putPage(draft.id, 0, "combined", blob);
    } catch {
      throw Error(
        "This browser could not combine the page into one image. Turn off the combined image and send the ordered screenshots instead.",
      );
    }
  }
  async function repairCombinedPage(draft) {
    const blob = await getPage(draft.id, 0, "combined");
    if (!blob) throw Error("The combined image is missing. Retry from this browser.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      if (!combinedImageNeedsResize(bitmap.width, bitmap.height)) return blob;
    } catch {
      // A previous browser version may have stored an image it cannot decode.
      // Rebuild from the still-approved numbered pages rather than losing them.
    } finally {
      bitmap?.close();
    }
    await combineApprovedPages(draft);
    return getPage(draft.id, 0, "combined");
  }
  function submitProgress(draft, message, completed, total) {
    chrome.runtime
      .sendMessage({ type: "submitProgress", id: draft.id, message, completed, total })
      .catch(() => {});
  }
  async function submit(message) {
    if (sending) throw Error("Submission is already in progress.");
    sending = true;
    let publishedDraft;
    try {
      let { draft } = await get();
      if (!draft || draft.id !== message.id) throw Error("No pending draft.");
      if (!draft.frozen) {
        requireImageRevision(draft, message.imageRevision);
        if (!draft.body.trim() && !draft.context.annotations?.length)
          throw Error("Write a comment before sending.");
        const series = !!draft.capturePages?.length;
        if (
          !draft.noImage &&
          series &&
          draft.capturePages.some(
            (_, index) => !draft.approvedPageIndices?.includes(index),
          )
        )
          throw Error("Review and approve every screenshot page before sending.");
        if (
          !draft.noImage &&
          !series &&
          !message.image?.startsWith("data:image/png;base64,")
        )
          throw Error("Approve the annotated screenshot first.");
        if (!draft.noImage && !series && message.image.length > 7 * 1024 * 1024)
          throw Error(
            "The annotated image is too large. Use Send without screenshot, or discard and capture a smaller window.",
          );
        if (message.imageWithoutPins && !series && !draft.noImage) {
          if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(message.imageWithoutPins))
            throw Error("The pin-free screenshot is invalid.");
          const withoutPins = await (await fetch(message.imageWithoutPins)).blob();
          if (!withoutPins.size || withoutPins.size > 10 * 1024 * 1024)
            throw Error("The pin-free screenshot exceeds the server's per-image size.");
          await putPage(draft.id, 0, "single-without-pins", withoutPins);
        } else if (!series) await deletePage(draft.id, 0, "single-without-pins");
        if (series && !draft.noImage && draft.includeCombined) {
          const indices = continuousDraft(draft).indices;
          draft.combinedWithoutPins =
            indices.some((index) =>
              draft.pageToolStates?.[index]?.some((shape) => shape.tool === "point"),
            ) &&
            (
              await Promise.all(
                indices.map(
                  async (index) =>
                    !draft.pageToolStates?.[index]?.some(
                      (shape) => shape.tool === "point",
                    ) || !!(await getPage(draft.id, index, "without-pins")),
                ),
              )
            ).every(Boolean);
          await combineApprovedPages(draft);
        }
        draft = {
          ...draft,
          frozen: true,
          approvedMarkings: series
            ? undefined
            : summarizeMarkings(
                draft.toolState,
                draft.context.captureDimensions?.width || draft.context.viewport.width,
                draft.context.captureDimensions?.height || draft.context.viewport.height,
                draft.context.annotations,
              ),
          approvedImage: draft.noImage ? null : message.image,
          approvedDiagnostics:
            draft.includeDiagnostics && !draft.diagnosticEvidence && draft.diagnostics
              ? {
                  ...draft.diagnostics,
                  approved: true,
                  console: draft.diagnostics.console.filter((_, index) =>
                    draft.diagnosticsSelection?.console?.includes(index),
                  ),
                  network: draft.diagnostics.network.filter((_, index) =>
                    draft.diagnosticsSelection?.network?.includes(index),
                  ),
                }
              : undefined,
          image: null,
          toolState: [],
        };
        await set({ draft });
      }
      if (draft.includeDiagnostics && draft.diagnosticEvidence?.evidenceId) {
        const currentIdentity = await accountIdentity(
          draft.server,
          draft.evidenceOwnerIdentity,
        );
        if (!currentIdentity || currentIdentity !== draft.evidenceOwnerIdentity)
          throw Error(
            "Connect the account used for this capture before sending its diagnostics.",
          );
      }
      if (!draft.thread) {
        draft.thread = await authenticated(
          "threads.create",
          {
            projectId: draft.projectId,
            body:
              draft.body.trim() ||
              `${draft.context.annotations.length} annotated ${draft.context.annotations.length === 1 ? "point" : "points"}: ${draft.context.annotations[0].body}`.slice(
                0,
                12000,
              ),
            context: draft.context,
            category: draft.category || "general",
            tags: draft.tags || [],
            ...(draft.approvedDiagnostics
              ? { diagnostics: draft.approvedDiagnostics }
              : {}),
            idempotencyKey: draft.id,
          },
          draft.server,
        );
        await set({ draft });
      }
      publishedDraft = draft;
      chrome.tabs
        .sendMessage(draft.sourceTabId, {
          type: "feedbackThreadCreated",
          fingerprint: draft.context.anchor?.fingerprint,
          url: `${draft.server}/threads/${draft.thread.id}`,
        })
        .catch(() => {});
      if (draft.approvedImage) {
        const withoutPins = await getPage(draft.id, 0, "single-without-pins");
        if (!draft.uploadAttempt) {
          draft.uploadAttempt = {
            threadId: draft.thread.id,
            revision: draft.thread.revision,
            rendition: withoutPins ? "screenshot" : "annotated",
            captureRegion: {
              startY: draft.context.scroll?.y || 0,
              endY: (draft.context.scroll?.y || 0) + draft.context.viewport.height,
              pageWidth: draft.context.viewport.width,
            },
            markings: draft.approvedMarkings,
            idempotencyKey: draft.id + "-image",
          };
          await set({ draft });
        }
        let result;
        try {
          if (draft.uploadAttempt.rendition === "screenshot" && !withoutPins)
            throw Error(
              "The approved pin-free screenshot is missing. Retry from this browser.",
            );
          result = await authenticated(
            "assets.upload",
            {
              ...draft.uploadAttempt,
              imageBase64:
                draft.uploadAttempt.rendition === "screenshot"
                  ? await pageDataUrl(withoutPins)
                  : draft.approvedImage,
            },
            draft.server,
          );
        } catch (error) {
          if (error.code === "CONFLICT") {
            // A confirmed revision rejection occurred before upload. Unknown
            // network outcomes retain the exact prior payload and key instead.
            draft.thread = await authenticated(
              "threads.get",
              { threadId: draft.thread.id },
              draft.server,
            );
            draft.uploadAttempt = {
              ...draft.uploadAttempt,
              revision: draft.thread.revision,
              idempotencyKey: crypto.randomUUID(),
            };
            await set({ draft });
            throw Object.assign(
              Error(
                "The thread changed. Its current revision is loaded; Retry Send will attach the same approved image.",
              ),
              { code: "CONFLICT" },
            );
          }
          throw error;
        }
        draft.thread = result.thread;
      }
      if (draft.capturePages?.length && !draft.noImage) {
        const totalImages = draft.capturePages.length + (draft.includeCombined ? 1 : 0);
        submitProgress(
          draft,
          `Uploading ${draft.capturePages.length} numbered screenshots…`,
          draft.uploadIndex || 0,
          totalImages,
        );
        for (
          let index = draft.uploadIndex || 0;
          index < draft.capturePages.length;
          index++
        ) {
          const withoutPins = await getPage(draft.id, index, "without-pins");
          const blob = withoutPins || (await getPage(draft.id, index, "approved"));
          if (!blob)
            throw Error(
              `Approved screenshot ${index + 1} is missing. Retry from this browser.`,
            );
          if (!draft.pageUploadAttempt) {
            draft.pageUploadAttempt = {
              threadId: draft.thread.id,
              revision: draft.thread.revision,
              rendition: withoutPins ? "screenshot" : "annotated",
              filename: draft.capturePages[index].name,
              captureRegion: {
                startY: draft.capturePages[index].startY,
                endY: draft.capturePages[index].endY,
                pageWidth:
                  draft.capturePages[index].viewportWidth || draft.context.viewport.width,
              },
              captureSections: [
                {
                  startY: draft.capturePages[index].startY,
                  endY: draft.capturePages[index].endY,
                  pageWidth:
                    draft.capturePages[index].viewportWidth ||
                    draft.context.viewport.width,
                  imageTop: 0,
                  imageBottom: 1,
                },
              ],
              markings: summarizeMarkings(
                draft.pageToolStates?.[index],
                pagePixelSize(draft, draft.capturePages[index]).width,
                pagePixelSize(draft, draft.capturePages[index]).height,
                draft.context.annotations,
              ),
              idempotencyKey: `${draft.id}-page-${index + 1}`,
            };
            await set({ draft });
          }
          let result;
          try {
            if (draft.pageUploadAttempt.rendition === "screenshot" && !withoutPins)
              throw Error(
                `Pin-free screenshot ${index + 1} is missing. Retry from this browser.`,
              );
            submitProgress(
              draft,
              `Uploading screenshot ${index + 1} of ${draft.capturePages.length}…`,
              index,
              totalImages,
            );
            result = await authenticated(
              "assets.upload",
              {
                ...draft.pageUploadAttempt,
                imageBase64: await pageDataUrl(
                  draft.pageUploadAttempt.rendition === "screenshot"
                    ? withoutPins
                    : await getPage(draft.id, index, "approved"),
                ),
              },
              draft.server,
            );
          } catch (error) {
            if (error.code === "CONFLICT") {
              draft.thread = await authenticated(
                "threads.get",
                { threadId: draft.thread.id },
                draft.server,
              );
              draft.pageUploadAttempt = {
                ...draft.pageUploadAttempt,
                revision: draft.thread.revision,
                idempotencyKey: crypto.randomUUID(),
              };
              await set({ draft });
            }
            throw Object.assign(
              Error(`Screenshot ${index + 1} could not upload: ${error.message}`),
              { code: error.code },
            );
          }
          draft.thread = result.thread;
          draft.uploadIndex = index + 1;
          draft.pageUploadAttempt = null;
          await set({ draft });
          submitProgress(
            draft,
            `Screenshot ${index + 1} uploaded.`,
            draft.uploadIndex,
            totalImages,
          );
        }
        if (draft.includeCombined && !draft.combinedUploaded) {
          submitProgress(
            draft,
            "Preparing the combined full-page image…",
            draft.capturePages.length,
            totalImages,
          );
          const blob = await repairCombinedPage(draft);
          if (!draft.combinedUploadAttempt) {
            draft.combinedUploadAttempt = {
              threadId: draft.thread.id,
              revision: draft.thread.revision,
              rendition: draft.combinedWithoutPins ? "screenshot" : "annotated",
              filename: "full-page-combined.webp",
              captureSections: combinedSections(draft),
              markings: combinedMarkings(draft),
              idempotencyKey: `${draft.id}-combined`,
            };
            await set({ draft });
          }
          let result;
          try {
            submitProgress(
              draft,
              "Uploading the combined full-page image…",
              draft.capturePages.length,
              totalImages,
            );
            result = await authenticated(
              "assets.upload",
              { ...draft.combinedUploadAttempt, imageBase64: await pageDataUrl(blob) },
              draft.server,
            );
          } catch (error) {
            if (error.code === "CONFLICT") {
              draft.thread = await authenticated(
                "threads.get",
                { threadId: draft.thread.id },
                draft.server,
              );
              draft.combinedUploadAttempt = {
                ...draft.combinedUploadAttempt,
                revision: draft.thread.revision,
                idempotencyKey: crypto.randomUUID(),
              };
              await set({ draft });
            }
            throw Object.assign(
              Error(`Combined image could not upload: ${error.message}`),
              { code: error.code },
            );
          }
          draft.thread = result.thread;
          draft.combinedUploaded = true;
          draft.combinedUploadAttempt = null;
          await set({ draft });
          submitProgress(draft, "All images uploaded.", totalImages, totalImages);
        }
      }
      if (draft.diagnosticUploaded && draft.diagnosticEvidence?.evidenceId)
        await diagnosticEvidenceStore.deleteEvidence(draft.diagnosticEvidence.evidenceId);
      if (draft.diagnosticEvidence?.evidenceId && !draft.diagnosticUploaded) {
        submitProgress(draft, "Uploading screenshot diagnostics…", 0, 1);
        await uploadDraftDiagnostics({
          draft,
          accountIdentity,
          authenticated,
          store: diagnosticEvidenceStore,
          save: async (updated) => set({ draft: updated }),
          progress: (completed, total) =>
            submitProgress(draft, "Uploading screenshot diagnostics…", completed, total),
        });
        await set({ draft });
      }
      const url = `${draft.server}/threads/${draft.thread.id}`;
      if (draft.capturePages?.length) await deleteDraftPages(draft.id);
      await deleteDraftPages(`point-${draft.sourceTabId}`);
      await chrome.storage.local.remove("draft");
      chrome.tabs
        .sendMessage(draft.sourceTabId, {
          type: "feedbackSaved",
          fingerprint: draft.context.anchor?.fingerprint,
        })
        .catch(() => {});
      return { url, threadId: draft.thread.id };
    } catch (error) {
      if (publishedDraft?.thread) {
        chrome.tabs
          .sendMessage(publishedDraft.sourceTabId, {
            type: "feedbackSubmissionIncomplete",
            url: `${publishedDraft.server}/threads/${publishedDraft.thread.id}`,
          })
          .catch(() => {});
      }
      throw error;
    } finally {
      sending = false;
    }
  }
  return { submit, isSending: () => sending };
}
