//src/iso/bytes.ts - tiny utils for building binary structures

/** 8-bit unsigned integer. */
export const u8 = (n: number) => { const b = Buffer.alloc(1); b.writeUInt8(n); return b; };
/** 16-bit unsigned integer (BE). */
export const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
/** 16-bit signed integer (BE). */
export const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
/** 24-bit unsigned integer (BE). */
export const u24 = (n: number) => { const b = Buffer.alloc(3); b[0]=(n>>>16)&0xff; b[1]=(n>>>8)&0xff; b[2]=n&0xff; return b; };
/** 32-bit unsigned integer (BE). */
export const u32 = (n: number) => {
  if (!Number.isFinite(n) || n < 0 || n > 0xFFFFFFFF) throw new Error(`u32 out of range: ${n}`);
  const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b;
};
/** ASCII string to Buffer. */
export const str = (s: string) => Buffer.from(s, 'ascii');
/** Null-terminated UTF-8 string. */
export const cstr = (s: string) => Buffer.from(s + '\0', 'utf8');
/** Zero padding. */
export const pad = (n: number) => Buffer.alloc(n, 0);
/** Concatenate Buffers. */
export const concat = (...parts: Buffer[]) => Buffer.concat(parts);
/**
 * Generic ISO box: [size(4)][type(4)][payload...].
 * @param type FourCC
 * @param payloads Buffers
 */
export const box = (type: string, ...payloads: Buffer[]) => {
  const content = concat(...payloads); return concat(u32(content.length + 8), str(type), content);
};
/** Fixed-point 16.16. */
export const fixed16_16 = (n: number) => Math.round(n * 65536);
/** Fixed-point signed 8.8. */
export const fixed8_8   = (n: number) => Math.round(n * 256) | 0; // signed 8.8
/** FullBox header (version + 24-bit flags). */
export const full = (version: number, flags: number) =>
  Buffer.from([version & 0xff, (flags>>>16)&0xff, (flags>>>8)&0xff, flags&0xff]);

/**
 * ESDS variable-length length encoding.
 * @param n Length
 */
export const vlen = (n: number) => {
  if (n < 0x80) return u8(n);
  const bytes: number[] = [];
  do { bytes.unshift(n & 0x7f); n >>>= 7; } while (n > 0);
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return Buffer.from(bytes);
};
