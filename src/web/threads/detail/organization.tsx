import React, { useState } from "react";
import { api, type Thread } from "../../api.js";
import {
  builtInCategories,
  categoryName,
  type ProjectTaxonomy,
} from "../../../shared/taxonomy.js";
import { TagBadge, TagPicker } from "../../project-taxonomy.js";
import { useUnsavedChanges } from "../../navigation.js";
import { ActionState, Field, useAction } from "../../ui.js";

export function ThreadOrganization({
  thread,
  canWrite,
  taxonomy,
  onSaved,
}: {
  thread: Thread;
  canWrite: boolean;
  taxonomy?: ProjectTaxonomy;
  onSaved: (thread: Thread) => void;
}) {
  const a = useAction();
  const [draft, setDraft] = useState<{
    category: string;
    tags: string[];
    revision: number;
  } | null>(null);
  const value = draft ?? {
    category: thread.category ?? "general",
    tags: thread.tags ?? [],
    revision: thread.revision,
  };
  const availableCategories = taxonomy?.categories ?? builtInCategories;
  useUnsavedChanges(!!draft || a.busy);
  return (
    <details className="section compact-details" id="thread-organize">
      <summary>Category &amp; tags</summary>
      {canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const pending = value;
            void a.run(async () => {
              onSaved(
                await api<Thread>("threads.organize", {
                  threadId: thread.id,
                  revision: pending.revision,
                  category: pending.category as "general",
                  tags: pending.tags,
                }),
              );
              setDraft(null);
            }, "Category and tags saved.");
          }}
        >
          <Field label="Category (optional)">
            <select
              name="category"
              value={value.category}
              disabled={a.busy}
              onChange={(e) => setDraft({ ...value, category: e.target.value })}
            >
              {availableCategories
                .filter(
                  (category) => !category.archived || category.id === value.category,
                )
                .map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                    {category.archived ? " (archived)" : ""}
                  </option>
                ))}
            </select>
          </Field>
          <TagPicker
            selected={value.tags}
            available={taxonomy?.tags ?? []}
            disabled={a.busy}
            onChange={(tags) => setDraft({ ...value, tags })}
          />
          <button disabled={a.busy || !draft}>Save category &amp; tags</button>
          {draft && draft.revision !== thread.revision && (
            <p role="status">
              This thread changed while you were editing.{" "}
              <button
                type="button"
                onClick={(e) => {
                  setDraft(null);
                  a.setError("");
                  const form = e.currentTarget.closest("form");
                  if (form) delete form.dataset.unsaved;
                }}
              >
                Load latest category &amp; tags
              </button>
            </p>
          )}
          <ActionState action={a} />
        </form>
      ) : (
        <p>
          {categoryName(availableCategories, thread.category)} ·{" "}
          {thread.tags?.length
            ? thread.tags.map((tag) => (
                <TagBadge key={tag} name={tag} tags={taxonomy?.tags ?? []} />
              ))
            : "No tags"}
        </p>
      )}
    </details>
  );
}
