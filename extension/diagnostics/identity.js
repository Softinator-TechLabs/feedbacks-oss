export async function accountFingerprint(account) {
  if (!account?.token) return null;
  if (account.id) return `user:${account.id}`;
  const bytes = new TextEncoder().encode(account.token);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `token:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
