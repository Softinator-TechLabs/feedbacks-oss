import React, { useEffect, useState } from "react";
import { tagSchema } from "../shared/contracts.js";
import {
  colorForTag,
  defaultTagColor,
  tagColors,
  type ProjectCategory,
  type ProjectTag,
  type ProjectTaxonomy,
} from "../shared/taxonomy.js";
import { api, errorText, type Project } from "./api.js";
import { ActionState, ErrorNotice, Field, useAction, useLoad } from "./ui.js";

export function TagBadge({ name, tags }: { name: string; tags: readonly ProjectTag[] }) {
  return <span className={`tag tag-color-${colorForTag(tags, name)}`}>{name}</span>;
}

export function TagPicker({
  selected,
  available,
  onChange,
  disabled,
}: {
  selected: string[];
  available: readonly ProjectTag[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState("");
  const remaining = available.filter((tag) => !selected.includes(tag.name));
  const add = (raw: string) => {
    const parsed = tagSchema.safeParse(raw);
    if (!parsed.success) {
      setError("Use 1–32 letters, numbers, spaces, /, _ or -.");
      return;
    }
    if (selected.length >= 12) {
      setError("A feedback item can have up to 12 tags.");
      return;
    }
    if (!selected.includes(parsed.data)) onChange([...selected, parsed.data].sort());
    setNewTag("");
    setError("");
  };
  return (
    <div className="tag-picker">
      {selected.length > 0 && (
        <div className="tag-list" aria-label="Selected tags">
          {selected.map((name) => (
            <span className="selected-tag" key={name}>
              <TagBadge name={name} tags={available} />
              <button
                type="button"
                className="tag-remove"
                aria-label={`Remove ${name} tag`}
                disabled={disabled}
                onClick={() => onChange(selected.filter((tag) => tag !== name))}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                >
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-picker-controls">
        <Field label="Choose an existing tag">
          <select
            value=""
            disabled={disabled || !remaining.length || selected.length >= 12}
            onChange={(event) => add(event.target.value)}
          >
            <option value="">{remaining.length ? "Select tag" : "No other tags"}</option>
            {remaining.map((tag) => (
              <option key={tag.name} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="tag-create-controls">
          <Field label="Or create a tag">
            <input
              value={newTag}
              maxLength={32}
              disabled={disabled || selected.length >= 12}
              placeholder="New tag"
              onChange={(event) => setNewTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add(newTag);
                }
              }}
            />
          </Field>
          <button
            type="button"
            disabled={disabled || !newTag.trim()}
            onClick={() => add(newTag)}
          >
            Add
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">New tags join this project when you save the feedback.</p>
    </div>
  );
}

function mergeCategoryDraft(
  previous: ProjectTaxonomy,
  latest: ProjectTaxonomy,
  draft: ProjectCategory[],
): ProjectCategory[] {
  const before = new Map(previous.categories.map((category) => [category.id, category]));
  const edited = new Map(
    draft.filter((category) => category.id).map((category) => [category.id, category]),
  );
  return [
    ...latest.categories
      .filter((category) => category.id.startsWith("custom:"))
      .map((category) => {
        const prior = before.get(category.id);
        const local = edited.get(category.id);
        return {
          ...category,
          name: prior && local && local.name !== prior.name ? local.name : category.name,
          archived:
            prior && local && local.archived !== prior.archived
              ? local.archived
              : category.archived,
        };
      }),
    ...draft.filter((category) => !category.id),
  ];
}

function mergeTagDraft(
  previous: ProjectTaxonomy,
  latest: ProjectTaxonomy,
  draft: ProjectTag[],
): ProjectTag[] {
  const before = new Map(previous.tags.map((tag) => [tag.name, tag]));
  const edited = new Map(draft.map((tag) => [tag.name, tag]));
  const current = new Set(latest.tags.map((tag) => tag.name));
  return [
    ...latest.tags.map((tag) => {
      const prior = before.get(tag.name);
      const local = edited.get(tag.name);
      return local &&
        (!prior || local.color !== prior.color || (local.managed && !prior.managed))
        ? { ...tag, color: local.color, managed: true }
        : tag;
    }),
    ...draft.filter((tag) => !current.has(tag.name)),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export function ProjectTaxonomySettings({
  projectId,
  projectRevision,
  onProjectSaved,
}: {
  projectId: string;
  projectRevision: number;
  onProjectSaved: (project: Project) => void;
}) {
  const action = useAction();
  const [version, setVersion] = useState(0);
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [newTag, setNewTag] = useState("");
  const [localError, setLocalError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [reloadingAfterConflict, setReloadingAfterConflict] = useState<number | null>(
    null,
  );
  const { data, error, setData } = useLoad<ProjectTaxonomy>(
    () => api("projects.taxonomy.get", { projectId }),
    [projectId, projectRevision, version],
  );
  useEffect(() => {
    if (data && !dirty) {
      setCategories(
        data.categories.filter((category) => category.id.startsWith("custom:")),
      );
      setTags(data.tags);
    }
  }, [data, dirty]);
  useEffect(() => {
    if (location.hash === "#project-taxonomy")
      requestAnimationFrame(() =>
        document.getElementById("project-taxonomy")?.scrollIntoView({ block: "start" }),
      );
  }, [projectId]);
  const addTag = () => {
    const parsed = tagSchema.safeParse(newTag);
    if (!parsed.success) {
      setLocalError("Tag names must use 1–32 letters, numbers, spaces, /, _ or -.");
      return;
    }
    if (tags.some((tag) => tag.name === parsed.data)) {
      setLocalError("This tag already exists.");
      return;
    }
    setTags(
      [
        ...tags,
        { name: parsed.data, color: defaultTagColor(parsed.data), managed: true },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setNewTag("");
    setLocalError("");
    setDirty(true);
  };
  return (
    <section className="section project-taxonomy" id="project-taxonomy">
      <h2>Categories &amp; tags</h2>
      <p className="muted">
        Keep names consistent across this project. Archived categories remain on older
        feedback.
      </p>
      <ErrorNotice error={error} />
      {error && (
        <button type="button" onClick={() => setVersion((value) => value + 1)}>
          Retry categories and tags
        </button>
      )}
      {data && (
        <form
          data-unsaved={dirty || action.busy ? "true" : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              const saved = await api<ProjectTaxonomy & { project: Project }>(
                "projects.taxonomy.update",
                {
                  projectId,
                  revision: data.revision,
                  categories: categories.map((category) => ({
                    ...(category.id ? { id: category.id } : {}),
                    name: category.name,
                    archived: category.archived,
                  })),
                  tags: tags
                    .filter(
                      (tag) =>
                        tag.managed &&
                        !data.tags.some(
                          (saved) =>
                            saved.managed &&
                            saved.name === tag.name &&
                            saved.color === tag.color,
                        ),
                    )
                    .map(({ name, color }) => ({ name, color })),
                },
              );
              setData(saved);
              setCategories(
                saved.categories.filter((category) => category.id.startsWith("custom:")),
              );
              setTags(saved.tags);
              setDirty(false);
              onProjectSaved(saved.project);
            }, "Categories and tags saved.");
          }}
        >
          <h3>Categories</h3>
          <p className="muted">
            Add category creates a draft. Save categories &amp; tags to make it available
            in this project's feedback.
          </p>
          <div className="taxonomy-defaults">
            {data.categories
              .filter((category) => !category.id.startsWith("custom:"))
              .map((category) => (
                <span className="category-badge" key={category.id}>
                  {category.name}
                </span>
              ))}
          </div>
          {categories.map((category, index) => (
            <div className="taxonomy-category-row" key={category.id || `new-${index}`}>
              <Field label={`Custom category ${index + 1}`}>
                <input
                  value={category.name}
                  maxLength={60}
                  required
                  disabled={action.busy || refreshBusy}
                  onChange={(event) => {
                    setCategories(
                      categories.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    );
                    setDirty(true);
                  }}
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={category.archived}
                  disabled={action.busy || refreshBusy}
                  onChange={(event) => {
                    setCategories(
                      categories.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, archived: event.target.checked }
                          : item,
                      ),
                    );
                    setDirty(true);
                  }}
                />
                Archived
              </label>
              {!category.id && (
                <button
                  type="button"
                  disabled={action.busy || refreshBusy}
                  onClick={() =>
                    setCategories(
                      categories.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  Remove draft
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={action.busy || refreshBusy}
            onClick={() => {
              setCategories([...categories, { id: "", name: "", archived: false }]);
              setDirty(true);
            }}
          >
            Add category
          </button>
          <h3>Tags and colors</h3>
          {tags.length ? (
            <div className="taxonomy-tags">
              {tags.map((tag, index) => (
                <div className="taxonomy-tag-row" key={tag.name}>
                  <TagBadge name={tag.name} tags={tags} />
                  <Field label={`Color for ${tag.name}`}>
                    <select
                      value={tag.color}
                      disabled={action.busy || refreshBusy}
                      onChange={(event) => {
                        setTags(
                          tags.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  color: event.target.value as ProjectTag["color"],
                                  managed: true,
                                }
                              : item,
                          ),
                        );
                        setDirty(true);
                      }}
                    >
                      {tagColors.map((color) => (
                        <option value={color} key={color}>
                          {color[0].toUpperCase() + color.slice(1)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No tags yet. Add one here or from feedback.</p>
          )}
          <div className="taxonomy-add-tag">
            <Field label="New project tag">
              <input
                value={newTag}
                maxLength={32}
                placeholder="e.g. checkout"
                disabled={action.busy || refreshBusy}
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag();
                  }
                }}
              />
            </Field>
            <button
              type="button"
              disabled={action.busy || refreshBusy || !newTag.trim()}
              onClick={addTag}
            >
              Add tag
            </button>
          </div>
          {localError && (
            <p className="error" role="alert">
              {localError}
            </p>
          )}
          <div className="actions">
            <button className="primary" disabled={action.busy || refreshBusy || !dirty}>
              Save categories &amp; tags
            </button>
            {dirty && (
              <button
                type="button"
                disabled={action.busy || refreshBusy}
                onClick={() => {
                  setCategories(
                    data.categories.filter((category) =>
                      category.id.startsWith("custom:"),
                    ),
                  );
                  setTags(data.tags);
                  setNewTag("");
                  setLocalError("");
                  setDirty(false);
                  action.setError("");
                }}
              >
                Discard changes
              </button>
            )}
          </div>
          {dirty && (
            <p className="muted" role="status">
              Changes are not saved yet. Save categories &amp; tags before leaving this
              page.
            </p>
          )}
          <ActionState action={action} />
          {action.error.includes("CONFLICT") && (
            <button
              type="button"
              disabled={refreshBusy}
              onClick={async () => {
                setRefreshBusy(true);
                try {
                  const latest = await api<ProjectTaxonomy>("projects.taxonomy.get", {
                    projectId,
                  });
                  setCategories((draft) => mergeCategoryDraft(data, latest, draft));
                  setTags((draft) => mergeTagDraft(data, latest, draft));
                  setReloadingAfterConflict(data.revision);
                  setData(latest);
                  setLocalError("");
                  action.setError("");
                } catch (error) {
                  setLocalError(errorText(error));
                } finally {
                  setRefreshBusy(false);
                }
              }}
            >
              Load latest without discarding draft
            </button>
          )}
          {reloadingAfterConflict !== null &&
            data.revision !== reloadingAfterConflict &&
            dirty && (
              <p role="status">
                Latest project changes loaded into your draft. Your edited values take
                precedence; review categories and tags before saving.
              </p>
            )}
        </form>
      )}
    </section>
  );
}
