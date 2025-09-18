// src/iso/bytes.ts — tiny utils for building binary structures (browser + node)

/** Allocate zero-filled bytes. */
const alloc = (n: number) => new Uint8Array(n);

/** 8-bit unsigned integer. */
export const u8 = (n: number) => {
  const b = alloc(1);
  b[0] = n & 0xFF;
  return b;
};

/** 16-bit unsigned integer (BE). */
export const u16 = (n: number) => {
  const b = alloc(2);
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint16(0, n >>> 0, false);
  return b;
};

/** 16-bit signed integer (BE). */
export const i16 = (n: number) => {
  const b = alloc(2);
  new DataView(b.buffer, b.byteOffset, b.byteLength).setInt16(0, n | 0, false);
  return b;
};

/** 24-bit unsigned integer (BE). */
export const u24 = (n: number) => {
  const b = alloc(3);
  b[0] = (n >>> 16) & 0xFF;
  b[1] = (n >>> 8) & 0xFF;
  b[2] = n & 0xFF;
  return b;
};

/** 32-bit unsigned integer (BE). */
export const u32 = (n: number) => {
  if (!Number.isFinite(n) || n < 0 || n > 0xFFFFFFFF) throw new Error(`u32 out of range: ${n}`);
  const b = alloc(4);
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(0, n >>> 0, false);
  return b;
};

/** ASCII string → bytes. */
export const str = (s: string) => {
  const out = alloc(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7F;
  return out;
};

/** Null-terminated UTF-8 string. */
export const cstr = (s: string) => {
  const enc = new TextEncoder();
  const utf8 = enc.encode(s);
  const out = alloc(utf8.length + 1);
  out.set(utf8, 0);
  // last byte already 0
  return out;
};

/** Zero padding. */
export const pad = (n: number) => alloc(n);

/** Concatenate byte arrays. */
export const concat = (...parts: Uint8Array[]) => {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = alloc(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};

/**
 * Generic ISO box: [size(4)][type(4)][payload...].
 * @param type FourCC
 * @param payloads Byte arrays
 */
export const box = (type: string, ...payloads: Uint8Array[]) => {
  const content = concat(...payloads);
  return concat(u32(content.length + 8), str(type), content);
};

/** Fixed-point 16.16. */
export const fixed16_16 = (n: number) => Math.round(n * 65536);

/** Fixed-point signed 8.8. */
export const fixed8_8 = (n: number) => Math.round(n * 256) | 0;

/** FullBox header (version + 24-bit flags). */
export const full = (version: number, flags: number) => {
  const b = alloc(4);
  b[0] = version & 0xFF;
  b[1] = (flags >>> 16) & 0xFF;
  b[2] = (flags >>> 8) & 0xFF;
  b[3] = flags & 0xFF;
  return b;
};

/**
 * ESDS variable-length length encoding.
 * @param n Length
 */
export const vlen = (n: number) => {
  if (n < 0x80) return u8(n);
  const bytes: number[] = [];
  do { bytes.unshift(n & 0x7F); n >>>= 7; } while (n > 0);
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  const out = alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i];
  return out;
};