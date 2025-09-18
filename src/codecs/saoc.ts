//src/codecs/saoc.ts - parse SAOC elementary stream with sidecar ASC, build MP4 sample entry - Experimental
import { box, u16, u32, concat } from '../iso/bytes';

/** Options for SAOC parsing with external AudioSpecificConfig. */
export type SaocOptions = {
  /** ASC as raw bytes (preferred). */
  ascBytes?: Uint8Array;
  /** ASC as text (hex or base64). */
  ascText?: string;
  /** Samples per frame; defaults to 1024. */
  samplesPerFrame?: number;
};

/**
 * Build an ISO/IEC 14496-1 ESDS box.
 * ES_Descriptor(03) -> DecoderConfig(04) -> DecSpecificInfo(05)
 */
function buildEsds(objectTypeIndication: number, dsi: Uint8Array) {
  const vlen = (n: number) => {
    const a: number[] = [];
    do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; a.push(b); } while (n);
    return new Uint8Array(a);
  };
  const tag = (t: number, payload: Uint8Array) =>
    concat(new Uint8Array([t]), vlen(payload.length), payload);

  const decSpecificInfo = tag(0x05, dsi);
  const decoderConfig = tag(
    0x04,
    concat(
      new Uint8Array([objectTypeIndication, 0x15, 0x00, 0x00, 0x00, 0x00]), // streamType(0x05)<<2|1 + buffer sizes
      decSpecificInfo
    )
  );
  const esDescriptor = tag(
    0x03,
    concat(
      new Uint8Array([0x00, 0x00]), // ES_ID=0
      new Uint8Array([0x00]),       // flags
      decoderConfig
    )
  );

  // version+flags(4) is added by caller via box('esds', u32(0), ...)
  return box('esds', u32(0), esDescriptor);
}

/** Decode ASC text (hex or base64) to bytes. */
function decodeAscText(txt?: string): Uint8Array | undefined {
  if (!txt) return undefined;
  const cleaned = txt.trim();
  const hex = cleaned.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(hex)) {
    const out = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  // base64 (atob) – works in browsers; in Node, global atob may not exist, but this path
  // is intended for browser usage; scripts should pass ascBytes instead.
  if (typeof atob === 'function') {
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }
  // Fallback: try TextDecoder from base64 via Uint8Array.from isn’t available without Buffer,
  // so require ascBytes in non-browser environments.
  throw new Error('ascText provided but base64 decoding is unavailable in this environment; pass ascBytes instead.');
}

/**
 * Parse SAOC elementary stream with sidecar ASC and provide MP4 sample entry.
 * Assumes 4-byte big-endian AU length prefixes.
 * @param raw Raw input buffer (length-prefixed AUs).
 * @param opts { ascBytes?, ascText?, samplesPerFrame? }
 */
export function parseSaocElementaryStream(raw: Uint8Array, opts: SaocOptions) {
  const u = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

  // Split into frames: assume 4-byte BE length before each AU
  const frames: Uint8Array[] = [];
  const sizes: number[] = [];
  let off = 0;
  while (off + 4 <= u.length) {
    const size = (u[off] << 24) | (u[off + 1] << 16) | (u[off + 2] << 8) | u[off + 3];
    off += 4;
    if (size < 0 || off + size > u.length) break;
    frames.push(u.slice(off, off + size));
    sizes.push(size);
    off += size;
  }

  const asc = opts.ascBytes ?? decodeAscText(opts.ascText);
  if (!asc) throw new Error('SAOC requires ascBytes or ascText (hex/base64)');

  const { sampleRate, channelCount, samplesPerFrame } =
    inferFromAsc(asc, opts.samplesPerFrame ?? 1024);

  const makeSampleEntry = () => {
    // mp4a + esds with OTI=0x40 and SAOC ASC as DecSpecificInfo
    const reserved6 = new Uint8Array(6); // reserved
    const DATA_REF_INDEX = u16(1);
    const channelCountU16 = u16(channelCount);
    const sampleSize = u16(16);
    const preDefined = u16(0);
    const reserved2 = u16(0);
    const sampleRate1616 = u32(sampleRate << 16);
    const esds = buildEsds(0x40, asc);

    return box(
      'mp4a',
      reserved6, DATA_REF_INDEX,
      u32(0), u32(0), u32(0),
      channelCountU16, sampleSize, preDefined, reserved2,
      sampleRate1616,
      esds
    );
  };

  return {
    codec: 'saoc' as const,
    sampleRate,
    channelCount,
    mdhdTimescale: sampleRate,
    samplesPerFrame,
    frames, sizes,
    makeSampleEntry,
  };
}

/**
 * Minimal inference from ASC; caller may override via opts.
 * You can replace with a proper ASC parser if needed.
 */
function inferFromAsc(_asc: Uint8Array, defaultSpf: number) {
  // Typical AAC core: 48 kHz, 2 ch, 1024 samples/frame (override if needed)
  return { sampleRate: 48000, channelCount: 2, samplesPerFrame: defaultSpf };
}
