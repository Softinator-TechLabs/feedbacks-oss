import React from "react";
import { Field } from "../ui.js";
export type CredentialStorage = "feedbacks" | "environment";
export function CredentialStorageChoice({
  value,
  onChange,
}: {
  value: CredentialStorage;
  onChange: (value: CredentialStorage) => void;
}) {
  return (
    <Field label="Store credentials">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as CredentialStorage)}
      >
        <option value="feedbacks">Encrypted in Feedbacks</option>
        <option value="environment">Deployment environment</option>
      </select>
    </Field>
  );
}
