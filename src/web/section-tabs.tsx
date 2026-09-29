import React from "react";

export type SectionTab<Id extends string> = {
  id: Id;
  label: string;
  panelId: string;
};

export function SectionTabs<Id extends string>({
  label,
  idPrefix,
  tabs,
  selected,
  onSelect,
}: {
  label: string;
  idPrefix: string;
  tabs: SectionTab<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <div className="section-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          id={`${idPrefix}-${tab.id}`}
          role="tab"
          aria-selected={selected === tab.id}
          aria-controls={tab.panelId}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            let nextIndex: number;
            if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft")
              nextIndex = (index + tabs.length - 1) % tabs.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = tabs.length - 1;
            else return;
            event.preventDefault();
            const next = tabs[nextIndex]!.id;
            onSelect(next);
            document.getElementById(`${idPrefix}-${next}`)?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
