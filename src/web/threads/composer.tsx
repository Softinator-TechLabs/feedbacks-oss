import { useRef, useState } from "react";
import { api, uid, type Project, type Thread } from "../api.js";
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
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            input = {
              projectId: project.id,
              body: String(f.get("body")),
              context: {
                url: String(f.get("url")),
                viewport: {
                  width: Number(f.get("width")),
                  height: Number(f.get("height")),
                },
              },
              category: String(f.get("category")) as "general",
              tags,
            };
          const signature = JSON.stringify(input);
          if (retry.current?.signature !== signature)
            retry.current = { signature, key: uid() };
          void a.run(async () =>
            onCreated(
              await api<Thread>("threads.create", {
                ...input,
                idempotencyKey: retry.current!.key,
              }),
            ),
          );
        }}
      >
        <Field label="Page URL">
          <input
            name="url"
            type="url"
            required
            placeholder={
              project.captureMode === "any"
                ? "https://example.org/page"
                : project.origins[0]
            }
          />
        </Field>
        <Field label="Category (optional)">
          <select name="category">
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
          />
        </div>
        <Field label="Viewport width (CSS px)">
          <input
            name="width"
            type="number"
            min={100}
            max={20000}
            defaultValue={1440}
            required
          />
        </Field>
        <Field label="Viewport height (CSS px)">
          <input
            name="height"
            type="number"
            min={100}
            max={20000}
            defaultValue={900}
            required
          />
        </Field>
        <Field label="Feedback">
          <textarea name="body" required maxLength={12000} rows={4} />
        </Field>
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
