import React, { useEffect, useId, useState } from "react";

const PASSWORD_LENGTH = 10;
const PASSWORD_ALPHABET = [
  "ABCDEFGHJKLMN",
  "PQRSTUVWXYZ",
  "abcdefghijk",
  "mnopqrstuvwxyz",
  "23456789",
].join("");

export function memberWelcomeMessage(
  member: { name: string; email: string; password: string },
  origin: string,
) {
  return `Hey ${member.name}, Feedbacks par join karein: ${origin}/login\nEmail: ${member.email}\nPassword: ${member.password}\nChrome extension aur Codex, Claude Code, Antigravity agent setup: ${origin}/help\nPlease sign in karke password change kar dein.`;
}

export function memberLoginDetails(
  member: { email?: string; password: string },
  origin: string,
) {
  return `Feedbacks login: ${origin}/login${member.email ? `\nEmail: ${member.email}` : ""}\nPassword: ${member.password}\nPlease sign in and change this password.`;
}

function generatePassword() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues)
    throw new Error("Secure password generation is unavailable in this browser.");
  const unbiasedLimit = 256 - (256 % PASSWORD_ALPHABET.length);
  let password = "";
  while (password.length < PASSWORD_LENGTH) {
    const bytes = cryptoApi.getRandomValues(
      new Uint8Array(PASSWORD_LENGTH - password.length),
    );
    for (const byte of bytes) {
      if (byte >= unbiasedLimit) continue;
      password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (password.length === PASSWORD_LENGTH) break;
    }
  }
  return password;
}

export function PasswordInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    statusId = `${id}-status`,
    [shown, setShown] = useState(false),
    [status, setStatus] = useState("");
  useEffect(() => {
    if (!value) {
      setShown(false);
      setStatus("");
    }
  }, [value]);
  return (
    <div className="field password-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name="password"
        type={shown ? "text" : "password"}
        autoComplete="new-password"
        minLength={PASSWORD_LENGTH}
        maxLength={1024}
        required
        value={value}
        aria-describedby={statusId}
        spellCheck={false}
        autoCapitalize="none"
        onChange={(event) => {
          onChange(event.target.value);
          setStatus("");
        }}
      />
      <small>At least 10 characters.</small>
      <div className="password-actions">
        <button
          type="button"
          onClick={() => {
            try {
              onChange(generatePassword());
              setShown(false);
              setStatus("New password generated.");
            } catch (error) {
              setStatus(
                error instanceof Error ? error.message : "Password generation failed.",
              );
            }
          }}
        >
          Generate password
        </button>
        <button
          type="button"
          disabled={!value}
          aria-pressed={shown}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            const write = navigator.clipboard?.writeText(value);
            if (!write) {
              setStatus("Could not copy. Select and copy the password manually.");
              return;
            }
            void write
              .then(() => setStatus("Password copied."))
              .catch(() =>
                setStatus("Could not copy. Select and copy the password manually."),
              );
          }}
        >
          Copy draft password
        </button>
      </div>
      <small id={statusId} role="status" aria-live="polite">
        {status}
      </small>
    </div>
  );
}
