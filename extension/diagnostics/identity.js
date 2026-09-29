export async function accountFingerprint(
  account,
  { userId = account?.userId, tokenOnly = false } = {},
) {
  if (!account?.token) return null;
  if (userId && !tokenOnly) return `user:${userId}`;
  const bytes = new TextEncoder().encode(account.token);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `token:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function sameDiagnosticBinding(left, right) {
  return (
    !!left &&
    !!right &&
    ["server", "projectId", "reviewId", "ownerIdentity"].every(
      (key) => left[key] === right[key],
    )
  );
}
