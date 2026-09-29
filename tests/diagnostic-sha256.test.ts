import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createSha256Hasher } from "../extension/diagnostics/sha256.js";

test("incremental SHA-256 matches known vectors across block boundaries", () => {
  const vectors = [
    {
      text: "",
      expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      text: "abc",
      expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    {
      text: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      expected: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
  ];
  for (const { text, expected } of vectors) {
    const bytes = new TextEncoder().encode(text);
    const hasher = createSha256Hasher();
    for (const byte of bytes) hasher.update(Uint8Array.of(byte));
    assert.equal(hasher.hexDigest(), expected);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  }
});

test("incremental SHA-256 hashes a 5 MiB+ stream with multibyte UTF-8 split at a 2 MiB boundary", () => {
  const hasher = createSha256Hasher();
  const reference = createHash("sha256");
  let total = 0;
  const append = (bytes: Uint8Array) => {
    hasher.update(bytes);
    reference.update(bytes);
    total += bytes.byteLength;
  };
  const prefix = new Uint8Array(2 * 1024 * 1024 - 1);
  for (let i = 0; i < prefix.length; i++) prefix[i] = i & 0xff;
  append(prefix);
  const unicode = new TextEncoder().encode("é😀");
  append(unicode.subarray(0, 1));
  append(unicode.subarray(1, 3));
  append(unicode.subarray(3));
  const block = new Uint8Array(1024 * 1024);
  for (let i = 0; i < block.length; i++) block[i] = (i * 31) & 0xff;
  for (let i = 0; i < 4; i++) append(block);
  assert.ok(total > 5 * 1024 * 1024);
  assert.equal(hasher.hexDigest(), reference.digest("hex"));
});

test("digest is idempotent and finalization rejects further updates", () => {
  const hasher = createSha256Hasher();
  hasher.update(new TextEncoder().encode("final"));
  const digest = hasher.hexDigest();
  assert.equal(hasher.hexDigest(), digest);
  assert.throws(() => hasher.update(Uint8Array.of(1)), /finalized/i);
});
