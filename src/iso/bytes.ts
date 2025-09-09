//src/lib/bytes.ts - tiny utils for building binary structures
export const u8 = (n: number) => { const b = Buffer.alloc(1); b.writeUInt8(n); return b; };
export const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
export const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
export const u24 = (n: number) => { const b = Buffer.alloc(3); b[0]=(n>>>16)&0xff; b[1]=(n>>>8)&0xff; b[2]=n&0xff; return b; };
export const u32 = (n: number) => {
  if (!Number.isFinite(n) || n < 0 || n > 0xFFFFFFFF) throw new Error(`u32 out of range: ${n}`);
  const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b;
};
export const str = (s: string) => Buffer.from(s, 'ascii');
export const cstr = (s: string) => Buffer.from(s + '\0', 'utf8');
export const pad = (n: number) => Buffer.alloc(n, 0);
export const concat = (...parts: Buffer[]) => Buffer.concat(parts);
export const box = (type: string, ...payloads: Buffer[]) => {
  const content = concat(...payloads); return concat(u32(content.length + 8), str(type), content);
};
export const fixed16_16 = (n: number) => Math.round(n * 65536);
export const fixed8_8   = (n: number) => Math.round(n * 256) | 0; // signed 8.8
export const full = (version: number, flags: number) =>
  Buffer.from([version & 0xff, (flags>>>16)&0xff, (flags>>>8)&0xff, flags&0xff]);

// ESDS variable length
export const vlen = (n: number) => {
  if (n < 0x80) return u8(n);
  const bytes: number[] = [];
  do { bytes.unshift(n & 0x7f); n >>>= 7; } while (n > 0);
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return Buffer.from(bytes);
};
