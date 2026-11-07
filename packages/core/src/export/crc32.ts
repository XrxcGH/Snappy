/**
 * CRC-32 (the checksum zip stores for every entry), computed incrementally so a streamed or
 * extracted entry can be verified without holding it whole. Operates on bytes only: it never
 * decodes anything and keeps no data.
 */
const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

export class Crc32 {
  private state = 0xffffffff;

  update(bytes: Uint8Array): this {
    let c = this.state;
    for (let i = 0; i < bytes.length; i++) c = (TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
    this.state = c;
    return this;
  }

  /** The checksum of everything given so far, as an unsigned 32-bit number. */
  digest(): number {
    return (this.state ^ 0xffffffff) >>> 0;
  }
}

/** CRC-32 of a whole byte array. */
export const crc32 = (bytes: Uint8Array): number => new Crc32().update(bytes).digest();
