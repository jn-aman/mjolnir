/**
 * MurmurHash3, 32 bit, seed 0.
 *
 * This is the hash Unleash uses to decide which side of a percentage rollout
 * you fall on. Using the same one means a machine that is inside a 20% rollout
 * here is inside it in every other Unleash client too, and stays inside it
 * tomorrow. Any other hash would be stable but wrong.
 */
export function murmur3(key: string): number {
  const bytes = new TextEncoder().encode(key);
  const length = bytes.length;
  const remainder = length & 3;
  const blocks = length - remainder;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h1 = 0;
  let index = 0;

  const rotl = (value: number, shift: number): number => (value << shift) | (value >>> (32 - shift));
  const multiply = (a: number, b: number): number => {
    // Split into 16-bit halves so the product stays inside a double exactly.
    const aLow = a & 0xffff;
    const aHigh = a >>> 16;
    return (((aLow * b) >>> 0) + ((((aHigh * b) & 0xffff) << 16) >>> 0)) >>> 0;
  };

  while (index < blocks) {
    let k1 =
      (bytes[index] ?? 0) |
      ((bytes[index + 1] ?? 0) << 8) |
      ((bytes[index + 2] ?? 0) << 16) |
      ((bytes[index + 3] ?? 0) << 24);
    index += 4;
    k1 = multiply(k1, c1);
    k1 = rotl(k1, 15);
    k1 = multiply(k1, c2);
    h1 ^= k1;
    h1 = rotl(h1, 13);
    h1 = (multiply(h1, 5) + 0xe6546b64) >>> 0;
  }

  let k1 = 0;
  if (remainder === 3) k1 ^= (bytes[index + 2] ?? 0) << 16;
  if (remainder >= 2) k1 ^= (bytes[index + 1] ?? 0) << 8;
  if (remainder >= 1) {
    k1 ^= bytes[index] ?? 0;
    k1 = multiply(k1, c1);
    k1 = rotl(k1, 15);
    k1 = multiply(k1, c2);
    h1 ^= k1;
  }

  h1 ^= length;
  h1 ^= h1 >>> 16;
  h1 = multiply(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = multiply(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  return h1 >>> 0;
}

/** Unleash normalisation: a stable number in 1..normaliser for a rollout decision. */
export function normalise(id: string, groupId: string, normaliser = 100): number {
  return (murmur3(`${groupId}:${id}`) % normaliser) + 1;
}
