import { useRef, useState } from "react";
import { api, uid, type Project, type Thread } from "../api.js";
import { tagSchema, tagsSchema } from "../../shared/contracts.js";
import { builtInCategories, type ProjectTaxonomy } from "../../shared/taxonomy.js";
import { TagPicker } from "../project-taxonomy.js";
import { ActionState, Field, useAction } from "../ui.js";
export function ThreadComposer({
  project,
  taxonomy,
  onCreated,
}: {
  project: Project;
  taxonomy?: ProjectTaxonomy;
  onCreated: (t: Thread) => void;
}) {
  const a = useAction(),
    retry = useRef<{ signature: string; key: string } | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  return (
    <section className="section">
      <h2>New feedback</h2>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget,
            fields = new FormData(form);
          void a.run(async () => {
            const pending = String(fields.get("newTag") ?? "").trim();
            const parsed = pending ? tagSchema.safeParse(pending) : undefined;
            if (parsed && !parsed.success)
              throw Error("Use 1–32 letters, numbers, spaces, /, _ or - for a tag.");
            const submittedTags = [
              ...new Set([...tags, ...(parsed?.success ? [parsed.data] : [])]),
            ].sort();
            if (!tagsSchema.safeParse(submittedTags).success)
              throw Error("A feedback item can have up to 12 tags.");
            const pageUrl = String(fields.get("url") ?? "").trim();
            const input = {
              projectId: project.id,
              body: String(fields.get("body")),
              ...(pageUrl ? { pageUrl } : {}),
              category: String(fields.get("category")) as "general",
              tags: submittedTags,
            };
            const signature = JSON.stringify(input);
            if (retry.current?.signature !== signature)
              retry.current = { signature, key: uid() };
            const thread = await api<Thread>("threads.create", {
              ...input,
              idempotencyKey: retry.current!.key,
            });
            delete form.dataset.unsaved;
            onCreated(thread);
          });
        }}
      >
        <Field label="Feedback">
          <textarea name="body" required maxLength={12000} rows={4} disabled={a.busy} />
        </Field>
        <details className="wide manual-feedback-options">
          <summary>Optional details</summary>
          <div className="form-grid">
            <Field label="Page URL (optional)">
              <input
                name="url"
                type="url"
                disabled={a.busy}
                placeholder={
                  project.captureMode === "any"
                    ? "https://example.org/page"
                    : project.origins[0]
                }
              />
            </Field>
            <Field label="Category (optional)">
              <select name="category" disabled={a.busy} defaultValue="general">
                {(taxonomy?.categories ?? builtInCategories)
                  .filter((category) => !category.archived)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="wide">
              <TagPicker
                selected={tags}
                available={taxonomy?.tags ?? []}
                onChange={setTags}
                disabled={a.busy}
                inputName="newTag"
              />
            </div>
          </div>
        </details>
        <div className="form-end">
          <p className="muted">
            For an exact element pin and a screenshot, capture from the Chrome extension.
          </p>
          <ActionState action={a} />
          <button className="primary" disabled={a.busy}>
            {a.busy ? "Posting…" : "Post feedback"}
          </button>
        </div>
      </form>
    </section>
  );
}
