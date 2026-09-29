import { type Delegation } from "../../shared/contracts.js";
import { type Thread } from "../api.js";
import { HumanTime } from "../human-time.js";
import {
  builtInCategories,
  categoryName,
  type ProjectTaxonomy,
} from "../../shared/taxonomy.js";
import { assignmentActor, assignmentScope } from "./model.js";
import { decisions } from "./types.js";
export function AssignmentSnapshot({
  item,
  thread,
  taxonomy,
}: {
  item: Delegation;
  thread: Thread;
  taxonomy?: ProjectTaxonomy;
}) {
  return (
    <div>
      <h4>Current assignment · revision {item.revision}</h4>
      <p>
        <strong>{item.memberName}</strong> · {assignmentScope(item.annotationIds, thread)}{" "}
        · {item.state === "cancelled" ? "Cancelled" : "Assigned"}
      </p>
      <p>{item.summary}</p>
      <p>
        {categoryName(taxonomy?.categories ?? builtInCategories, item.category)}
        {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
      </p>
      <p>
        {decisions[item.githubDecision]} · {item.githubRationale}
      </p>
      <p>
        Last updated by {assignmentActor(item.updatedBy)} ·{" "}
        <HumanTime at={item.updatedAt} />
      </p>
    </div>
  );
}
