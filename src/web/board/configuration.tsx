import { useState } from "react";
import {
  boardConfigurationSchema,
  boardStates,
  type BoardConfiguration,
} from "../../shared/board.js";
import { api, labels } from "../api.js";
import { useUnsavedChanges } from "../navigation.js";
import { ActionState, Field, showToast, useAction } from "../ui.js";
import type { ProjectBoardData } from "./model.js";

export function BoardConfigurationEditor({
  board,
  onSaved,
}: {
  board: ProjectBoardData;
  onSaved: (board: ProjectBoardData) => void;
}) {
  const [draft, setDraft] = useState<BoardConfiguration>(() =>
    structuredClone(board.configuration),
  );
  const [changed, setChanged] = useState(false);
  const action = useAction();
  useUnsavedChanges(changed || action.busy);
  function update(next: BoardConfiguration) {
    setDraft(next);
    setChanged(true);
  }
  function reorder(index: number, direction: -1 | 1) {
    const columns = [...draft.columns];
    [columns[index], columns[index + direction]] = [
      columns[index + direction],
      columns[index],
    ];
    update({ ...draft, columns });
  }
  return (
    <details className="board-settings">
      <summary>Configure columns</summary>
      <p>
        Columns group the existing work statuses. New feedback enters the column
        containing Open. Moving a card saves its work status.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const parsed = boardConfigurationSchema.safeParse(draft);
            if (!parsed.success)
              throw new Error(
                parsed.error.issues.map((issue) => issue.message).join(". "),
              );
            const saved = await api<ProjectBoardData>("board.configure", {
              projectId: board.projectId,
              revision: board.revision,
              configuration: parsed.data,
            });
            setChanged(false);
            showToast("Board columns saved.");
            onSaved(saved);
          }, "Board columns saved.");
        }}
      >
        <fieldset disabled={action.busy}>
          <div className="board-column-editor">
            {draft.columns.map((column, index) => (
              <div key={column.id} className="board-column-editor-row">
                <Field label={`Column ${index + 1}`}>
                  <input
                    value={column.name}
                    maxLength={60}
                    required
                    onChange={(event) =>
                      update({
                        ...draft,
                        columns: draft.columns.map((value) =>
                          value.id === column.id
                            ? { ...value, name: event.target.value }
                            : value,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Status when moved here">
                  <select
                    value={column.entryState}
                    onChange={(event) =>
                      update({
                        ...draft,
                        columns: draft.columns.map((value) =>
                          value.id === column.id
                            ? {
                                ...value,
                                entryState: event.target.value as typeof value.entryState,
                              }
                            : value,
                        ),
                      })
                    }
                  >
                    {column.states.length ? (
                      column.states.map((state) => (
                        <option key={state} value={state}>
                          {labels[state]}
                        </option>
                      ))
                    ) : (
                      <option value="open">Assign a work status below</option>
                    )}
                  </select>
                </Field>
                <div className="actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={`Move ${column.name} earlier`}
                    onClick={() => reorder(index, -1)}
                  >
                    Earlier
                  </button>
                  <button
                    type="button"
                    disabled={index === draft.columns.length - 1}
                    aria-label={`Move ${column.name} later`}
                    onClick={() => reorder(index, 1)}
                  >
                    Later
                  </button>
                  <button
                    type="button"
                    disabled={
                      column.id === draft.intakeColumnId || draft.columns.length === 1
                    }
                    onClick={() => {
                      const columns = draft.columns
                        .filter((value) => value.id !== column.id)
                        .map((value) =>
                          value.id === draft.intakeColumnId
                            ? { ...value, states: [...value.states, ...column.states] }
                            : value,
                        );
                      update({ ...draft, columns });
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          {draft.columns.length < 5 && (
            <button
              type="button"
              onClick={() =>
                update({
                  ...draft,
                  columns: [
                    ...draft.columns,
                    {
                      id: `column_${crypto.randomUUID().slice(0, 8)}`,
                      name: "New column",
                      states: [],
                      entryState: "open",
                    },
                  ],
                })
              }
            >
              Add column
            </button>
          )}
          <div className="board-state-mapping">
            {boardStates.map((state) => (
              <Field key={state} label={`Column for ${labels[state]}`}>
                <select
                  value={
                    draft.columns.find((column) => column.states.includes(state))?.id ??
                    ""
                  }
                  onChange={(event) => {
                    const targetId = event.target.value;
                    update({
                      ...draft,
                      ...(state === "open" ? { intakeColumnId: targetId } : {}),
                      columns: draft.columns.map((column) => {
                        const states = column.states.filter((value) => value !== state);
                        if (column.id === targetId) states.push(state);
                        return {
                          ...column,
                          states,
                          entryState: states.includes(column.entryState)
                            ? column.entryState
                            : (states[0] ?? "open"),
                        };
                      }),
                    });
                  }}
                >
                  {draft.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <div className="actions">
            <button className="primary" disabled={!changed}>
              Save columns
            </button>
            <button
              type="button"
              disabled={!changed}
              onClick={() => {
                setDraft(structuredClone(board.configuration));
                setChanged(false);
              }}
            >
              Discard changes
            </button>
          </div>
        </fieldset>
        <ActionState action={action} />
      </form>
    </details>
  );
}
