import React from "react";
import { labels } from "../api.js";
import { Field } from "../ui.js";
import type { Policy } from "./types.js";
const categories = [
  "general",
  "visualDesign",
  "productWorkflow",
  "usabilityAccessibility",
] as const;
export const expertiseCategories = categories.map((category) => labels[category]);
export function PolicyFields({
  policy,
  prefix = "",
}: {
  policy?: Policy;
  prefix?: string;
}) {
  return (
    <div className="policy-fields">
      <Field label="Overall importance" hint="1 is normal, 2 counts twice, 0 ignores.">
        <input
          type="number"
          name={`${prefix}general`}
          min={0}
          max={10}
          step={0.1}
          defaultValue={policy?.general ?? 1}
          required
        />
      </Field>
      <details className="policy-topics">
        <summary>Set a different weight for a topic</summary>
        <div className="policy-grid">
          {categories.slice(1).map((c) => (
            <Field key={c} label={labels[c]} hint="Blank uses the overall importance.">
              <input
                type="number"
                name={`${prefix}${c}`}
                min={0}
                max={10}
                step={0.1}
                defaultValue={policy?.[c] ?? ""}
                placeholder="Use overall"
              />
            </Field>
          ))}
        </div>
      </details>
    </div>
  );
}
export function readPolicy(f: FormData, prefix = "") {
  return Object.fromEntries(
    categories.flatMap((c) =>
      f.get(`${prefix}${c}`) === "" ? [] : [[c, Number(f.get(`${prefix}${c}`))]],
    ),
  ) as Policy;
}
