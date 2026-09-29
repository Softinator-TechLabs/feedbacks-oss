import React from "react";
export function RoleSelect({ value = "maintainer" }: { value?: string }) {
  return (
    <select name="role" defaultValue={value}>
      <option value="viewer">Viewer — read only</option>
      <option value="reviewer">Reviewer — comment & update</option>
      <option value="maintainer">Maintainer — manage project & resolve</option>
    </select>
  );
}
