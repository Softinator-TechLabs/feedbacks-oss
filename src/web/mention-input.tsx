import React, { useEffect, useId, useRef, useState } from "react";
import type { MentionEdit, MentionRange } from "./mention-ranges.js";

type Member = { id: string; name: string; active: boolean };
export function MentionInput({
  value,
  onChange,
  members,
  onMention,
}: {
  value: string;
  onChange: (value: string, edit?: MentionEdit) => void;
  members: Member[];
  onMention: (mention: MentionRange) => void;
}) {
  const id = useId(),
    input = useRef<HTMLTextAreaElement>(null),
    pendingEdit = useRef<{ start: number; end: number; inputType: string } | undefined>(
      undefined,
    );
  const [caret, setCaret] = useState(0),
    [closed, setClosed] = useState(false),
    [active, setActive] = useState(0);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const captureEdit = (event: InputEvent) => {
      pendingEdit.current = {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        inputType: event.inputType,
      };
    };
    textarea.addEventListener("beforeinput", captureEdit);
    return () => textarea.removeEventListener("beforeinput", captureEdit);
  }, []);
  const match = value.slice(0, caret).match(/(?:^|\s)@([^\n@]{0,60})$/);
  const query = match?.[1].toLocaleLowerCase();
  const choices =
    query !== undefined && !closed
      ? members
          .filter(
            (member) => member.active && member.name.toLocaleLowerCase().includes(query),
          )
          .slice(0, 8)
      : [];
  const selected = Math.min(active, choices.length - 1);
  function choose(member: Member) {
    if (!match) return;
    const start = caret - match[1].length - 1,
      token = `@${member.name} `;
    onChange(value.slice(0, start) + token + value.slice(caret), {
      start,
      end: caret,
      nextEnd: start + token.length,
    });
    onMention({
      start,
      end: start + token.length - 1,
      id: member.id,
      label: member.name,
    });
    setClosed(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  return (
    <div className="mention-composer">
      <label className="sr-only" htmlFor={id}>
        Reply
      </label>
      <textarea
        ref={input}
        id={id}
        value={value}
        rows={5}
        required
        maxLength={12000}
        placeholder="Write a reply… Use @ to mention someone."
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={choices.length > 0}
        aria-controls={choices.length ? `${id}-members` : undefined}
        aria-activedescendant={choices.length ? `${id}-member-${selected}` : undefined}
        onChange={(event) => {
          const next = event.target.value,
            pending = pendingEdit.current;
          let edit: MentionEdit | undefined;
          if (pending) {
            let { start, end } = pending;
            const removed = value.length - next.length;
            if (start === end && removed > 0) {
              if (pending.inputType.endsWith("Backward"))
                start = Math.max(0, start - removed);
              else if (pending.inputType.endsWith("Forward"))
                end = Math.min(value.length, end + removed);
            }
            const candidate = {
              start,
              end,
              nextEnd: start + next.length - (value.length - (end - start)),
            };
            if (
              candidate.nextEnd >= candidate.start &&
              value.slice(0, candidate.start) === next.slice(0, candidate.start) &&
              value.slice(candidate.end) === next.slice(candidate.nextEnd)
            )
              edit = candidate;
            else edit = { start: 0, end: value.length, nextEnd: next.length };
          }
          pendingEdit.current = undefined;
          onChange(next, edit);
          setCaret(event.target.selectionStart);
          setClosed(false);
          setActive(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onBlur={() => setClosed(true)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || !choices.length) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setClosed(true);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(
              (selected + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
                choices.length,
            );
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            choose(choices[selected]);
          }
        }}
      />
      {choices.length > 0 && (
        <div
          className="mention-menu"
          id={`${id}-members`}
          role="listbox"
          aria-label="Project members"
        >
          {choices.map((member, index) => (
            <button
              type="button"
              role="option"
              key={member.id}
              id={`${id}-member-${index}`}
              aria-selected={index === selected}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(member)}
            >
              {member.name}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mention-trigger"
        aria-label="Mention someone"
        onClick={() => {
          const position = input.current?.selectionStart ?? value.length;
          const prefix = value.slice(0, position),
            insertion = `${prefix && !/\s$/.test(prefix) ? " " : ""}@`;
          onChange(prefix + insertion + value.slice(position), {
            start: position,
            end: position,
            nextEnd: position + insertion.length,
          });
          setCaret(position + insertion.length);
          setClosed(false);
          setActive(0);
          requestAnimationFrame(() => {
            input.current?.focus();
            input.current?.setSelectionRange(
              position + insertion.length,
              position + insertion.length,
            );
          });
        }}
      >
        @
      </button>
    </div>
  );
}
