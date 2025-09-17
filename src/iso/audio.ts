// src/iso/audio.ts
import { u8, u16, u24, u32, i16, str, cstr, pad, concat, box, fixed16_16, full, vlen } from './bytes';

// ---- Generic track shape for the muxer ----
/** Codec-agnostic audio track for muxing. */
export type MuxTrack = {
  sampleRate: number;
  /** mdhd duration in timescale units (usually = sampleRate). */
  mdhdDuration: number;
  /** Per-sample byte sizes. */
  sizes: number[];
  /** Number of samples/frames. */
  frameCount: number;
  /** Samples per frame (AAC=1024, MP3=1152, etc.). */
  samplesPerFrame?: number;
  /** Encoded samples. */
  frames: Uint8Array[];
  /** Preferred: builder for stsd entry. */
  makeSampleEntry?: () => Uint8Array;

  // Legacy AAC fallback:
  /** AudioSpecificConfig. */
  asc?: Uint8Array;
  /** AAC channel configuration. */
  channelConfig?: number;
};

// ---------------- ESDS + sample entry builders ----------------

/**
 * Build 'esds' box for AAC.
 * @param asc AudioSpecificConfig.
 * @param avgBitrate Average bitrate (bps).
 * @param maxBitrate Max bitrate (bps).
 */
export function esdsBox(asc: Uint8Array, avgBitrate = 0, maxBitrate = 0) {
  const esDescrHeader = concat(u8(0x03), vlen(3 + 5 + (2 + asc.length) + 3), u16(1), u8(0x00));
  const objType = 0x40, streamType = 0x15;
  const dcdCore = concat(u8(objType), u8(streamType), u24(0), u32(maxBitrate >>> 0), u32(avgBitrate >>> 0));
  const decConfigDescr = concat(u8(0x04), vlen(dcdCore.length + (2 + asc.length) + 3), dcdCore);
  const dsi = concat(u8(0x05), vlen(asc.length), asc);
  const sl = concat(u8(0x06), vlen(1), u8(0x02));
  const descriptors = concat(esDescrHeader, decConfigDescr, dsi, sl);
  return box('esds', u32(0), descriptors);
}

/**
 * Build 'mp4a' sample entry.
 * @param sampleRate Hz.
 * @param channels Channel count.
 * @param asc AudioSpecificConfig.
 */
export function mp4aSampleEntry(sampleRate: number, channels: number, asc: Uint8Array) {
  const se = concat(
    pad(6), u16(1),
    u16(0), u16(0), u32(0),
    u16(channels || 2), u16(16), u16(0), u16(0),
    u32(fixed16_16(sampleRate)),
    esdsBox(asc)
  );
  return box('mp4a', se);
}

// ---------------- stbl helpers (now codec-agnostic) ----------------
/** Single-entry 'stsd'. */
export const stsd = (entry: Uint8Array) => box('stsd', u32(0), u32(1), entry);

/** 'stts' with one run: frameCount × samplesPerFrame. */
export const stts = (frameCount: number, samplesPerFrame: number) =>
  box('stts', u32(0), u32(1), u32(frameCount), u32(samplesPerFrame >>> 0));

/** Trivial 'stsc' (1:1). */
export const stsc = () =>
  box('stsc', u32(0), u32(1), u32(1), u32(1), u32(1));

/** Build 'stsz' from sizes. */
export const stsz = (sizes: number[]) => {
  const arr = new Uint8Array(4 * sizes.length);
  const dv = new DataView(arr.buffer);
  sizes.forEach((s, i) => dv.setUint32(i * 4, s >>> 0, false));
  return box('stsz', u32(0), u32(0), u32(sizes.length), arr);
};

/** Build 'stco' from chunk offsets. */
export const stco = (offsets: number[]) => {
  const arr = new Uint8Array(4 * offsets.length);
  const dv = new DataView(arr.buffer);
  offsets.forEach((o, i) => dv.setUint32(i * 4, o >>> 0, false));
  return box('stco', u32(0), u32(offsets.length), arr);
};

/** 'smhd' sound media header. */
export const smhd = () => box('smhd', u32(0), u16(0), u16(0));

/** Minimal self-referencing data reference. */
export const dinf_minimal_url_self = () => {
  const url = box('url ', u32(1));
  const dref = box('dref', u32(0), u32(1), url);
  return box('dinf', dref);
};

/** 'hdlr' for audio ('soun'). */
export const hdlr_soun = () => {
  const name = cstr('SoundHandler');
  return box('hdlr', u32(0), u32(0), str('soun'), u32(0), u32(0), u32(0), name);
};

// ---------------- timing headers ----------------
/** 3×3 unity matrix (Q16.16). */
const MATRIX_UNITY = concat(
  u32(0x00010000), u32(0x00000000), u32(0x00000000), // a, b, u
  u32(0x00000000), u32(0x00010000), u32(0x00000000), // c, d, v
  u32(0x00000000), u32(0x00000000), u32(0x40000000), // x, y, w
);

/**
 * Build 'mdhd' (v0) for audio.
 * @param sampleRate Timescale.
 * @param durationSamples Duration in samples.
 */
export function mdhd(sampleRate: number, durationSamples: number) {
  const lang = ((('u'.charCodeAt(0) - 96) << 10) | (('n'.charCodeAt(0) - 96) << 5) | ('d'.charCodeAt(0) - 96)) & 0x7fff;
  return box('mdhd', u32(0), u32(0), u32(0), u32(sampleRate), u32(durationSamples), u16(lang), u16(0));
}

/**
 * Build 'tkhd' for an audio track.
 * @param trackId Track ID.
 * @param movieTimescale Movie timescale.
 * @param trackDurationSamples Track duration in samples.
 * @param sampleRate Track timescale (Hz).
 */
export function tkhd(trackId: number, movieTimescale: number, trackDurationSamples: number, sampleRate: number) {
  const durationMv = Math.round(trackDurationSamples / sampleRate * movieTimescale);
  const flags = 0x0007;
  const flagsBytes = concat(u8(0), u8((flags >> 16) & 0xff), u8((flags >> 8) & 0xff), u8(flags & 0xff));
  return box('tkhd',
    flagsBytes,
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

/**
 * Build 'mvhd' (v0).
 * @param movieTimescale Timescale.
 * @param movieDurationMv Duration in movie timescale units.
 */
export function mvhd(movieTimescale: number, movieDurationMv: number) {
  return box('mvhd', u32(0), u32(0), u32(0), u32(movieTimescale), u32(movieDurationMv), u32(0x00010000), u16(0x0100), u16(0),
    u32(0), u32(0), MATRIX_UNITY, pad(24), u32(4));
}

// ---------------- codec-agnostic stbl/minf/mdia ----------------

/** Choose the correct SampleEntry for a track (prefers makeSampleEntry). */
function chooseSampleEntry(t: MuxTrack): Uint8Array {
  if (t.makeSampleEntry) return t.makeSampleEntry();
  if (!t.asc) throw new Error('Track is missing makeSampleEntry() and AAC asc; cannot build stsd entry.');
  if (t.channelConfig == null) throw new Error('AAC track missing channelConfig; cannot build stsd entry.');
  return mp4aSampleEntry(t.sampleRate, t.channelConfig, t.asc);
}

/**
 * Build 'stbl' for an audio track.
 * @param t Track data.
 * @param chunkOffsets Chunk offsets for stco.
 */
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

/**
 * Build 'minf' for an audio track.
 * @param t Track data.
 * @param chunkOffsets Chunk offsets for stco.
 */
export function minf_for_track(t: MuxTrack, chunkOffsets: number[]) {
  return box('minf', smhd(), dinf_minimal_url_self(), stbl_for_track(t, chunkOffsets));
}

/**
 * Build 'mdia' for an audio track.
 * @param t Track data.
 * @param chunkOffsets Chunk offsets for stco.
 */
export function mdia_for_track(t: MuxTrack, chunkOffsets: number[]) {
  return box('mdia', mdhd(t.sampleRate, t.mdhdDuration), hdlr_soun(), minf_for_track(t, chunkOffsets));
}

/**
 * Optional builder: returns a trak builder using the given trackId/timescale.
 * @param t Track data.
 * @param trackId Track ID.
 * @param movieTimescale Movie timescale.
 */
export function trak_for_track(t: MuxTrack, trackId: number, movieTimescale: number) {
  const trakBox = (mdia: Uint8Array) => box('trak', tkhd(trackId, movieTimescale, t.mdhdDuration, t.sampleRate), mdia);
  return { build: (chunkOffsets: number[]) => trakBox(mdia_for_track(t, chunkOffsets)) };
}
