// src/lib/audio.ts
import { u8, u16, u24, u32, i16, str, cstr, pad, concat, box, fixed16_16, full, vlen } from './bytes';

// ---- Generic track shape for the muxer ----
// Works with:
//  - New codecs (MP3/PCM/SAOC): provide makeSampleEntry(), frameCount, samplesPerFrame.
//  - Legacy AAC: provide asc + channelConfig (+ frameCount). samplesPerFrame defaults to 1024.
export type MuxTrack = {
  sampleRate: number;
  mdhdDuration: number;           // in mdhd timescale units (usually = sampleRate)
  sizes: number[];                // sample sizes (bytes)
  frameCount: number;             // number of samples/frames in the track
  samplesPerFrame?: number;       // e.g. AAC=1024, MP3=1152, PCM configurable; default 1024
  frames: Uint8Array[];
  // Preferred (codec-agnostic) path:
  makeSampleEntry?: () => Uint8Array | Buffer;

  // Legacy AAC fallback:
  asc?: Uint8Array | Buffer;      // AudioSpecificConfig
  channelConfig?: number;         // AAC channel configuration (1..7 typically)
};

// ---------------- ESDS + sample entry builders ----------------

export function esdsBox(asc: Uint8Array | Buffer, avgBitrate = 0, maxBitrate = 0) {
  const ascBuf = Buffer.isBuffer(asc) ? asc : Buffer.from(asc);
  const esDescrHeader = concat(u8(0x03), vlen(3 + 5 + (2 + ascBuf.length) + 3), u16(1), u8(0x00));
  const objType = 0x40, streamType = 0x15;
  const dcdCore = concat(u8(objType), u8(streamType), u24(0), u32(maxBitrate >>> 0), u32(avgBitrate >>> 0));
  const decConfigDescr = concat(u8(0x04), vlen(dcdCore.length + (2 + ascBuf.length) + 3), dcdCore);
  const dsi = concat(u8(0x05), vlen(ascBuf.length), ascBuf);
  const sl = concat(u8(0x06), vlen(1), u8(0x02));
  const descriptors = concat(esDescrHeader, decConfigDescr, dsi, sl);
  return box('esds', u32(0), descriptors);
}

export function mp4aSampleEntry(sampleRate: number, channels: number, asc: Uint8Array | Buffer) {
  const ascBuf = Buffer.isBuffer(asc) ? asc : Buffer.from(asc);
  const se = concat(
    pad(6), u16(1),
    u16(0), u16(0), u32(0),
    u16(channels || 2), u16(16), u16(0), u16(0),
    u32(fixed16_16(sampleRate)),
    esdsBox(ascBuf)
  );
  return box('mp4a', se);
}

// ---------------- stbl helpers (now codec-agnostic) ----------------

export const stsd = (entry: Uint8Array | Buffer) => box('stsd', u32(0), u32(1), Buffer.isBuffer(entry) ? entry : Buffer.from(entry));

// stts now takes (frameCount, samplesPerFrame)
export const stts = (frameCount: number, samplesPerFrame: number) =>
  box('stts', u32(0), u32(1), u32(frameCount), u32(samplesPerFrame >>> 0));

export const stsc = () =>
  box('stsc', u32(0), u32(1), u32(1), u32(1), u32(1));

export const stsz = (sizes: number[]) => {
  const arr = Buffer.alloc(4 * sizes.length);
  sizes.forEach((s, i) => arr.writeUInt32BE(s >>> 0, i * 4));
  return box('stsz', u32(0), u32(0), u32(sizes.length), arr);
};

export const stco = (offsets: number[]) => {
  const arr = Buffer.alloc(4 * offsets.length);
  offsets.forEach((o, i) => arr.writeUInt32BE(o >>> 0, i * 4));
  return box('stco', u32(0), u32(offsets.length), arr);
};

export const smhd = () => box('smhd', u32(0), u16(0), u16(0));

export const dinf_minimal_url_self = () => {
  const url = box('url ', u32(1));
  const dref = box('dref', u32(0), u32(1), url);
  return box('dinf', dref);
};

export const hdlr_soun = () => {
  const name = Buffer.from('SoundHandler\0', 'ascii');
  return box('hdlr', u32(0), u32(0), str('soun'), u32(0), u32(0), u32(0), name);
};

// ---------------- timing headers ----------------
// 36-byte unity matrix (9 * u32)
const MATRIX_UNITY = Buffer.concat([
  u32(0x00010000), u32(0x00000000), u32(0x00000000), // a, b, u
  u32(0x00000000), u32(0x00010000), u32(0x00000000), // c, d, v
  u32(0x00000000), u32(0x00000000), u32(0x40000000), // x, y, w
]);

export function mdhd(sampleRate: number, durationSamples: number) {
  const lang = ((('u'.charCodeAt(0) - 96) << 10) | (('n'.charCodeAt(0) - 96) << 5) | ('d'.charCodeAt(0) - 96)) & 0x7fff;
  return box('mdhd', u32(0), u32(0), u32(0), u32(sampleRate), u32(durationSamples), u16(lang), u16(0));
}

export function tkhd(trackId: number, movieTimescale: number, trackDurationSamples: number, sampleRate: number) {
  const durationMv = Math.round(trackDurationSamples / sampleRate * movieTimescale);
  const flags = 0x0007;
  return box('tkhd',
    Buffer.concat([u8(0), u8((flags >> 16) & 0xff), u8((flags >> 8) & 0xff), u8(flags & 0xff)]),
    u32(0), u32(0),
    u32(trackId), u32(0),
    u32(durationMv),
    u32(0), u32(0),
    u16(0), u16(0),
    u16(0x0100), u16(0),
    MATRIX_UNITY,
    u32(0), u32(0)
  );
}

export function mvhd(movieTimescale: number, movieDurationMv: number) {
  return box('mvhd', u32(0), u32(0), u32(0), u32(movieTimescale), u32(movieDurationMv), u32(0x00010000), u16(0x0100), u16(0),
    u32(0), u32(0), MATRIX_UNITY, Buffer.alloc(24, 0), u32(4));
}

// ---------------- codec-agnostic stbl/minf/mdia ----------------

// Choose the right sample entry for this track.
function chooseSampleEntry(t: MuxTrack): Buffer {
  if (t.makeSampleEntry) {
    const entry = t.makeSampleEntry();
    return Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
  }
  // Legacy AAC fallback
  if (!t.asc) throw new Error('Track is missing makeSampleEntry() and AAC asc; cannot build stsd entry.');
  if (t.channelConfig == null) throw new Error('AAC track missing channelConfig; cannot build stsd entry.');
  return mp4aSampleEntry(t.sampleRate, t.channelConfig, t.asc);
}

export function stbl_for_track(t: MuxTrack, chunkOffsets: number[]) {
  const entry = chooseSampleEntry(t);
  const spf = (t.samplesPerFrame ?? 1024) >>> 0;
  return box('stbl',
    stsd(entry),
    stts(t.frameCount, spf),
    stsc(),
    stsz(t.sizes),
    stco(chunkOffsets)
  );
}

export function minf_for_track(t: MuxTrack, chunkOffsets: number[]) {
  return box('minf', smhd(), dinf_minimal_url_self(), stbl_for_track(t, chunkOffsets));
}

export function mdia_for_track(t: MuxTrack, chunkOffsets: number[]) {
  return box('mdia', mdhd(t.sampleRate, t.mdhdDuration), hdlr_soun(), minf_for_track(t, chunkOffsets));
}

// Optional helper, if you like the builder pattern:
export function trak_for_track(t: MuxTrack, trackId: number, movieTimescale: number) {
  const trakBox = (mdia: Buffer) => box('trak', tkhd(trackId, movieTimescale, t.mdhdDuration, t.sampleRate), mdia);
  return { build: (chunkOffsets: number[]) => trakBox(mdia_for_track(t, chunkOffsets)) };
}