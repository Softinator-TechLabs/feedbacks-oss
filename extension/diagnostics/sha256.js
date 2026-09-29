// Incremental SHA-256 for extension evidence streams. Memory use is independent
// of input size: only one partial block and one message schedule are retained.
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));

export function createSha256Hasher() {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);
  const block = new Uint8Array(64);
  const words = new Uint32Array(64);
  let blockLength = 0;
  let byteLength = 0;
  let digest = null;

  function compress(bytes, offset) {
    for (let i = 0; i < 16; i++) {
      const index = offset + i * 4;
      words[i] =
        ((bytes[index] << 24) |
          (bytes[index + 1] << 16) |
          (bytes[index + 2] << 8) |
          bytes[index + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15];
      const y = words[i - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sum1 + choice + ROUND_CONSTANTS[i] + words[i]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  function update(bytes) {
    if (digest !== null) throw new Error("SHA-256 hasher is finalized");
    if (!(bytes instanceof Uint8Array))
      throw new TypeError("SHA-256 update requires a Uint8Array");
    byteLength += bytes.byteLength;
    let offset = 0;
    if (blockLength > 0) {
      const count = Math.min(bytes.byteLength, 64 - blockLength);
      block.set(bytes.subarray(0, count), blockLength);
      blockLength += count;
      offset = count;
      if (blockLength === 64) {
        compress(block, 0);
        blockLength = 0;
      }
    }
    while (offset + 64 <= bytes.byteLength) {
      compress(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.byteLength) {
      block.set(bytes.subarray(offset), 0);
      blockLength = bytes.byteLength - offset;
    }
  }

  function hexDigest() {
    if (digest !== null) return digest;
    block[blockLength++] = 0x80;
    if (blockLength > 56) {
      block.fill(0, blockLength);
      compress(block, 0);
      blockLength = 0;
    }
    block.fill(0, blockLength, 56);
    const highBits = Math.floor(byteLength / 0x20000000) >>> 0;
    const lowBits = (byteLength * 8) >>> 0;
    for (let i = 0; i < 4; i++) {
      block[56 + i] = highBits >>> (24 - i * 8);
      block[60 + i] = lowBits >>> (24 - i * 8);
    }
    compress(block, 0);
    digest = Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
    return digest;
  }

  return { update, hexDigest };
}
