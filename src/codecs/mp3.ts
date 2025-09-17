// src/codecs/mp3.ts - parse MP3 files to get raw MP3 frames and build MP4 sample entry
import { box, full, u16, u32, str, concat, fixed16_16 } from '../iso/bytes';

/** Parsed MP3 frame header essentials used for muxing. */
type Mp3Header = {
  /** MPEG version (1, 2, or 2.5 encoded as 25). */
  version: 1 | 2 | 25;        // 25 represents MPEG 2.5
  /** Only Layer III is supported. */
  layer: 3;                    // we only admit Layer III
  /** Sampling rate in Hz. */
  sampleRate: number;
  /** 1 mono, 2 stereo. */
  channelCount: number;        // 1: mono, 2: stereo
  /** Samples per MP3 frame (1152 for v1, 576 for v2/2.5). */
  samplesPerFrame: number;     // 1152 or 576
  /** Frame byte size (computed later). */
  frameSize: number;           // bytes
};

const SR_TABLE = {
  0: [44100, 48000, 32000],   // MPEG1
  2: [22050, 24000, 16000],   // MPEG2
  3: [11025, 12000, 8000],    // MPEG2.5
} as const;

// kbps tables for Layer III
const BR_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BR_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

/**
 * Parse an MP3 header at offset.
 * @param b Byte buffer.
 * @param off Offset into buffer.
 * @returns Parsed header or null if invalid.
 */
function parseHeader(b: Uint8Array, off: number): Mp3Header | null {
  if (off + 4 > b.length) return null;
  const h = (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
  if (((h >>> 21) & 0x7ff) !== 0x7ff) return null; // 11-bit sync
  const verBits = (h >>> 19) & 0x3;                 // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layerBits = (h >>> 17) & 0x3;               // 1=Layer3
  if (layerBits !== 1) return null;                 // only Layer III
  const srIdx = (h >> 10) & 0x3;
  const mode = (h >> 6) & 0x3;                      // 3=mono
  if (srIdx === 3) return null;

  const version = verBits === 3 ? 1 : (verBits === 2 ? 2 : 25);
  const srRow = version === 1 ? 0 : (version === 2 ? 2 : 3);
  const sampleRate = SR_TABLE[srRow as 0 | 2 | 3][srIdx];
  const channelCount = (mode === 3) ? 1 : 2;
  const samplesPerFrame = (version === 1) ? 1152 : 576;

  return { version, layer: 3, sampleRate, channelCount, samplesPerFrame, frameSize: 0 };
}

/**
 * Compute MP3 Layer III frame size from header value.
 * @param h 32-bit header value.
 * @param hdr Parsed header fields.
 * @returns Frame byte length or null if unsupported.
 */
function frameSizeFromHeader(h: number, hdr: Mp3Header): number | null {
  const bitrateIdx = (h >>> 12) & 0xf;
  const padding = (h >>> 9) & 0x1;
  if (bitrateIdx === 0 || bitrateIdx === 0xf) return null; // free/forbidden
  const kbps = (hdr.version === 1 ? BR_MPEG1_L3[bitrateIdx] : BR_MPEG2_L3[bitrateIdx]);
  if (!kbps) return null;
  const coeff = (hdr.version === 1) ? 144000 : 72000; // bytes = coeff * kbps / Hz + padding
  return Math.floor((coeff * kbps) / hdr.sampleRate) + padding;
}

/**
 * Parse an MP3 file buffer into frames and MP4 sample entry builder.
 * @param buf Uint8Array containing MP3 data. (Node Buffer is fine; it's a Uint8Array subclass.)
 * @returns Parsed track info, frames, and stsd builder.
 * @throws If no MP3 frames are found.
 */
export function parseMp3File(buf: Uint8Array) {
  const u = (buf instanceof Uint8Array)
    ? buf
    : new Uint8Array((buf as any).buffer ?? buf);

  const frames: Uint8Array[] = [];
  const sizes: number[] = [];
  let off = 0;
  let header: Mp3Header | null = null;

  // Skip ID3v2 if present
  if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) {
    const flags = u[5];
    const size = ((u[6] & 0x7f) << 21) | ((u[7] & 0x7f) << 14) | ((u[8] & 0x7f) << 7) | (u[9] & 0x7f);
    const footer = (flags & 0x10) ? 10 : 0; // v2.4 footer present
    off = 10 + size + footer;
  }

  // Frame scan using header-derived size
  while (off + 4 <= u.length) {
    const hdr = parseHeader(u, off);
    if (!hdr) { off++; continue; }
    if (!header) header = hdr;
    const hval = (u[off] << 24) | (u[off + 1] << 16) | (u[off + 2] << 8) | u[off + 3];
    const size = frameSizeFromHeader(hval, hdr);
    if (!size || size < 4 || off + size > u.length) break;
    frames.push(u.slice(off, off + size));
    sizes.push(size);
    off += size;
  }

  // Optional: trim trailing ID3v1 ("TAG") if present (no action needed; kept for parity)

  if (!header) throw new Error('No MP3 frames found');

  const mdhdTimescale = header.sampleRate;

  const makeSampleEntry = () => {
    // stsd entry: mp4a + esds(OTI=0x6B, empty DSI)
    const DATA_REF_INDEX = u16(1);
    const reserved6 = new Uint8Array(6); // reserved
    const channelCount = u16(header.channelCount);
    const sampleSize = u16(16);
    const preDefined = u16(0);
    const reserved2 = u16(0);
    const sampleRate1616 = u32(fixed16_16(header.sampleRate));

    const esds = buildEsds(0x6B, new Uint8Array(0)); // MP3 OTI
    return box('mp4a',
      reserved6, DATA_REF_INDEX,
      u32(0), u32(0), u32(0),            // reserved (version fields)
      channelCount, sampleSize, preDefined, reserved2,
      sampleRate1616,
      esds
    );
  };

  return {
    codec: 'mp3' as const,
    sampleRate: header.sampleRate,
    channelCount: header.channelCount,
    mdhdTimescale,
    samplesPerFrame: header.samplesPerFrame,
    frames,
    sizes,
    makeSampleEntry,
  };
}

/**
 * Build an ISO/IEC 14496-1 ESDS box for MP3 (OTI=0x6B).
 * @param objectTypeIndication Object Type Indication (e.g. 0x6B for MP3).
 * @param dsi Decoder Specific Info payload.
 * @returns 'esds' MP4 box.
 */
function buildEsds(objectTypeIndication: number, dsi: Uint8Array) {
  // ES_Descriptor(03) -> DecoderConfig(04) -> DecSpecificInfo(05)

  const vlen = (n: number) => {
    const out: number[] = [];
    do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; out.push(b); } while (n);
    return Uint8Array.from(out);
  };
  const tag = (t: number, payload: Uint8Array) => concat(u16(t & 0xff).subarray(1), vlen(payload.length), payload);
  // u16(...).subarray(1) gives a single byte like u8(t) without adding another helper.

  const decSpecificInfo = tag(0x05, dsi);

  const decoderConfig = tag(
    0x04,
    concat(
      // objectTypeIndication, streamType(0x15), bufferSizeDB(0), maxBitrate(0), avgBitrate(0)
      Uint8Array.of(objectTypeIndication, 0x15, 0x00, 0x00, 0x00, 0x00),
      decSpecificInfo
    )
  );

  const esDescriptor = tag(
    0x03,
    concat(
      Uint8Array.of(0x00, 0x00), // ES_ID=0
      Uint8Array.of(0x00),       // flags
      decoderConfig
    )
  );

  // Keep payload shape consistent with original code
  return box('esds', u32(0), esDescriptor);
}
