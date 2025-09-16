// src/demux/tx3g-demux.ts
/* Demux tx3g Timed Text from .3gp/.mp4 into cues and SRT */
import type { MuxTx3gTrack } from "../iso/subtitle";

/** Single subtitle cue in milliseconds. */
export type Tx3gCue = { startMs: number; endMs: number; text: string };

/** Minimal tx3g track info (timescale units, byte sizes, and file offsets). */
export type Tx3gTrack = {
  index: number;
  /** mdhd ISO-639-2/T (3 letters) or "und". */
  language: string;
  /** mdhd timescale. */
  timescale: number;
  /** Per-sample durations (timescale units). */
  durations: number[];
  /** Per-sample sizes (bytes). */
  sizes: number[];
  /** Absolute file offsets into mdat. */
  offsets: number[];
};

type Box = { type: string; start: number; size: number; header: number; end: number };

const be32 = (b: DataView, o: number) => b.getUint32(o, false);
const be16 = (b: DataView, o: number) => b.getUint16(o, false);
const be64 = (b: DataView, o: number) => {
  const hi = b.getUint32(o, false), lo = b.getUint32(o + 4, false);
  return hi * 2 ** 32 + lo;
};
const fourcc = (a: ArrayBufferLike, o: number) => new TextDecoder("ascii").decode(new Uint8Array(a, o, 4));

/** Iterate MP4 boxes in [from,to). */
function* boxes(ab: ArrayBufferLike, from = 0, to = (ab as ArrayBuffer).byteLength): Generator<Box> {
  let off = from;
  const dv = new DataView(ab as ArrayBuffer);
  while (off + 8 <= to) {
    let size = be32(dv, off);
    const type = fourcc(ab, off + 4);
    let hdr = 8, end = off + size;
    if (size === 1) { size = Number(be64(dv, off + 8)); hdr = 16; end = off + size; }
    if (size === 0) { end = to; size = end - off; }
    if (end > to || size < hdr) break;
    yield { type, start: off, size, header: hdr, end };
    off = end;
  }
}
const slice = (ab: ArrayBufferLike, start: number, len: number) =>
  new Uint8Array((ab as ArrayBuffer), start, len);

/** Return tx3g SampleEntry bytes from stsd (to preserve styling). */
function stsdTx3gEntryBytes(ab: ArrayBufferLike, stsd: Box): Uint8Array | undefined {
  // skip version/flags (4) + entry_count (4)
  let off = stsd.start + stsd.header + 8;
  const end = stsd.end;
  while (off + 8 <= end) {
    const dv = new DataView(ab as ArrayBuffer);
    let size = be32(dv, off);
    const type = fourcc(ab, off + 4);
    let hdr = 8;
    if (size === 1) { size = Number(be64(dv, off + 8)); hdr = 16; }
    if (type === "tx3g") return slice(ab, off, size); // whole SampleEntry box
    off += size;
  }
  return undefined;
}

/** Find a nested box by path (first match). */
function find(ab: ArrayBufferLike, parent: Box, path: string[]): Box | undefined {
  if (!path.length) return parent;
  const [head, ...rest] = path;
  for (const b of boxes(ab, parent.start + parent.header, parent.end)) {
    if (b.type === head) return find(ab, b, rest);
  }
  return undefined;
}

/** Collect all direct children of a given type. */
function findAll(ab: ArrayBufferLike, parent: Box, type: string): Box[] {
  const out: Box[] = [];
  for (const b of boxes(ab, parent.start + parent.header, parent.end)) {
    if (b.type === type) out.push(b);
  }
  return out;
}

/** Read mdhd → { timescale, duration, language }. */
function mdhdInfo(ab: ArrayBufferLike, mdhd: Box) {
  const dv = new DataView(ab as ArrayBuffer);
  const v = new Uint8Array(ab as ArrayBuffer, mdhd.start + mdhd.header, 1)[0];
  let o = mdhd.start + mdhd.header + 4; // skip version/flags
  if (v === 1) o += 16; else o += 8;     // creation+modification
  const timescale = be32(dv, o); o += 4;
  const duration = (v === 1) ? Number(be64(dv, o)) : be32(dv, o); o += (v === 1) ? 8 : 4;
  const langPacked = be16(dv, o); // 15-bit ISO-639-2/T
  const c1 = ((langPacked >> 10) & 31) + 0x60;
  const c2 = ((langPacked >> 5) & 31) + 0x60;
  const c3 = (langPacked & 31) + 0x60;
  const language = String.fromCharCode(c1, c2, c3);
  return { timescale, duration, language };
}

/** Get handler subtype (e.g., 'text'). */
function handlerType(ab: ArrayBufferLike, hdlr: Box) {
  const off = hdlr.start + hdlr.header + 8; // skip pre_defined + component subtype?
  return fourcc(ab, off); // actually component subtype in mp4; for text it's 'text'
}

/** Expand stts runs to per-sample durations. */
function readStts(ab: ArrayBufferLike, stts: Box): number[] {
  const dv = new DataView(ab as ArrayBuffer);
  let o = stts.start + stts.header + 4; // skip version/flags
  const count = be32(dv, o); o += 4;
  const durations: number[] = [];
  for (let i = 0; i < count; i++) {
    const sampleCount = be32(dv, o); o += 4;
    const delta = be32(dv, o); o += 4;
    for (let k = 0; k < sampleCount; k++) durations.push(delta);
  }
  return durations;
}

/** Read stsz to per-sample sizes (uses hint length when given). */
function readStsz(ab: ArrayBufferLike, stsz: Box, sampleCountHint?: number): number[] {
  const dv = new DataView(ab as ArrayBuffer);
  let o = stsz.start + stsz.header + 4; // skip version/flags
  const defaultSize = be32(dv, o); o += 4;
  const sampleCount = be32(dv, o); o += 4;
  const n = sampleCountHint ?? sampleCount;
  if (defaultSize !== 0) return Array(n).fill(defaultSize);
  const sizes = new Array<number>(n);
  for (let i = 0; i < n; i++) { sizes[i] = be32(dv, o); o += 4; }
  return sizes;
}

type StscEntry = { first_chunk: number; samples_per_chunk: number; desc_index: number };

/** Parse stsc entries. */
function readStsc(ab: ArrayBufferLike, stsc: Box): StscEntry[] {
  const dv = new DataView(ab as ArrayBuffer);
  let o = stsc.start + stsc.header + 4;
  const count = be32(dv, o); o += 4;
  const entries: StscEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({ first_chunk: be32(dv, o), samples_per_chunk: be32(dv, o + 4), desc_index: be32(dv, o + 8) });
    o += 12;
  }
  return entries;
}

/** Read chunk offsets from stco/co64. */
function readChunkOffsets(ab: ArrayBufferLike, stco?: Box, co64?: Box): number[] {
  if (co64) {
    const dv = new DataView(ab as ArrayBuffer);
    let o = co64.start + co64.header + 4; // version/flags
    const n = be32(dv, o); o += 4;
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) { out[i] = Number(be64(dv, o)); o += 8; }
    return out;
  }
  if (!stco) return [];
  const dv = new DataView(ab as ArrayBuffer);
  let o = stco.start + stco.header + 4; // version/flags
  const n = be32(dv, o); o += 4;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) { out[i] = be32(dv, o); o += 4; }
  return out;
}

/** Compute per-sample file offsets from sizes/chunks/stsc. */
function buildSampleOffsets(sizes: number[], chunkOffsets: number[], stscEntries: StscEntry[]): number[] {
  // Map chunk -> samples_per_chunk using stsc run-length
  const samplesPerChunk: number[] = [];
  for (let c = 1, i = 0; c <= chunkOffsets.length; c++) {
    while (i + 1 < stscEntries.length && stscEntries[i + 1].first_chunk <= c) i++;
    samplesPerChunk[c - 1] = stscEntries[i]?.samples_per_chunk ?? 1;
  }
  // Build offsets by walking chunks and accumulating sizes within each chunk
  const offsets: number[] = [];
  let sIdx = 0;
  for (let c = 0; c < chunkOffsets.length; c++) {
    let off = chunkOffsets[c];
    const n = samplesPerChunk[c] ?? 1;
    for (let j = 0; j < n && sIdx < sizes.length; j++, sIdx++) {
      offsets.push(off);
      off += sizes[sIdx];
    }
  }
  return offsets;
}

/** Decode a tx3g sample (u16 length + UTF-8 text). */
function decodeTx3gSample(ab: ArrayBufferLike, offset: number): string {
  const dv = new DataView(ab as ArrayBuffer);
  const len = be16(dv, offset);
  const bytes = new Uint8Array(ab as ArrayBuffer, offset + 2, len);
  const txt = new TextDecoder("utf-8").decode(bytes);
  // Ignore any trailing style/modifier boxes in the sample
  return txt.replace(/\r\n/g, "\n");
}

/**
 * Extract mux-ready tx3g tracks from an MP4: frames/sizes/durations/timescale + SampleEntry.
 * @param ab ISO-BMFF bytes.
 * @returns Array of MuxTx3gTrack; SampleEntry preserves default styling when present.
 */
export function extractTx3gMuxTracks(ab: ArrayBufferLike): MuxTx3gTrack[] {
  let moov: Box | undefined;
  for (const b of boxes(ab)) if (b.type === "moov") { moov = b; break; }
  if (!moov) throw new Error("moov not found");

  const muxTracks: MuxTx3gTrack[] = [];
  const traks = findAll(ab, moov, "trak");

  traks.forEach((trak) => {
    const mdia = find(ab, trak, ["mdia"]); if (!mdia) return;
    const hdlr = find(ab, mdia, ["hdlr"]); if (!hdlr) return;
    const htype = handlerType(ab, hdlr);

    const minf = find(ab, mdia, ["minf"]); if (!minf) return;
    const stbl = find(ab, minf, ["stbl"]); if (!stbl) return;
    const stsd = find(ab, stbl, ["stsd"]); if (!stsd) return;

    let hasTx3g = false;
    for (const e of boxes(ab, stsd.start + stsd.header + 8, stsd.end)) {
      if (e.type === "tx3g") { hasTx3g = true; break; }
    }
    if (!(htype === "text" || hasTx3g)) return; // not a timed-text track

    const mdhd = find(ab, mdia, ["mdhd"]); if (!mdhd) return;
    const { timescale, language } = mdhdInfo(ab, mdhd);
    const stts = find(ab, stbl, ["stts"]); if (!stts) return;
    const stsc = find(ab, stbl, ["stsc"]); if (!stsc) return;
    const stsz = find(ab, stbl, ["stsz"]); if (!stsz) return;
    const stco = find(ab, stbl, ["stco"]);
    const co64 = find(ab, stbl, ["co64"]);

    const durations = readStts(ab, stts);
    const sizes = readStsz(ab, stsz, durations.length);
    const chunkOffsets = readChunkOffsets(ab, stco, co64);
    const stscEntries = readStsc(ab, stsc);
    const offsets = buildSampleOffsets(sizes, chunkOffsets, stscEntries);

    // Gather raw sample frames
    const frames = sizes.map((sz, i) => slice(ab, offsets[i], sz));
    const mdhdDuration = durations.reduce((a, b) => a + b, 0);

    const entry = stsdTx3gEntryBytes(ab, stsd); // may be undefined; composer will fallback
    muxTracks.push({
      kind: "tx3g",
      timescale,
      mdhdDuration,
      frames,
      sizes,
      durations,
      language,
      makeSampleEntry: () => entry ? Buffer.from(entry) : undefined as any
    });
  });

  return muxTracks;
}

/**
 * Extract all tx3g tracks to timing tables and decoded cues.
 * @param ab ISO-BMFF bytes.
 * @returns { tracks, cues } where cues are in milliseconds.
 */
export function extractAllTx3gTracks(ab: ArrayBufferLike): { tracks: Tx3gTrack[]; cues: Tx3gCue[][] } {
  // Find moov
  let moov: Box | undefined;
  for (const b of boxes(ab)) if (b.type === "moov") { moov = b; break; }
  if (!moov) throw new Error("moov not found");

  const outTracks: Tx3gTrack[] = [];
  const outCues: Tx3gCue[][] = [];

  const traks = findAll(ab, moov, "trak");
  traks.forEach((trak, ti) => {
    const mdia = find(ab, trak, ["mdia"]);
    if (!mdia) return;
    const hdlr = find(ab, mdia, ["hdlr"]);
    if (!hdlr) return;
    const htype = handlerType(ab, hdlr);
    // 3GPP Timed Text uses handler 'text' or stsd entry 'tx3g'
    const minf = find(ab, mdia, ["minf"]); if (!minf) return;
    const stbl = find(ab, minf, ["stbl"]); if (!stbl) return;
    const stsd = find(ab, stbl, ["stsd"]); if (!stsd) return;

    let hasTx3g = false;
    for (const e of boxes(ab, stsd.start + stsd.header + 8, stsd.end)) { // skip version/flags + entry_count
      if (e.type === "tx3g") { hasTx3g = true; break; }
    }
    if (!(htype === "text" || hasTx3g)) return;

    const mdhd = find(ab, mdia, ["mdhd"]); if (!mdhd) return;
    const { timescale, language } = mdhdInfo(ab, mdhd);
    const stts = find(ab, stbl, ["stts"]); if (!stts) return;
    const stsc = find(ab, stbl, ["stsc"]); if (!stsc) return;
    const stsz = find(ab, stbl, ["stsz"]); if (!stsz) return;
    const stco = find(ab, stbl, ["stco"]);
    const co64 = find(ab, stbl, ["co64"]);

    const durations = readStts(ab, stts);
    const sizes = readStsz(ab, stsz, durations.length);
    const chunkOffsets = readChunkOffsets(ab, stco, co64);
    const stscEntries = readStsc(ab, stsc);
    const offsets = buildSampleOffsets(sizes, chunkOffsets, stscEntries);

    const cues: Tx3gCue[] = [];
    let pts = 0;
    for (let i = 0; i < sizes.length; i++) {
      const text = decodeTx3gSample(ab, offsets[i]);
      const dur = durations[i] ?? (durations.length ? durations[durations.length - 1] : 0);
      const startMs = Math.round((pts * 1000) / timescale);
      const endMs = Math.round(((pts + dur) * 1000) / timescale);
      cues.push({ startMs, endMs, text });
      pts += dur;
    }

    outTracks.push({ index: ti, language, timescale, durations, sizes, offsets });
    outCues.push(cues);
  });

  return { tracks: outTracks, cues: outCues };
}

/**
 * Convert cues to SRT (with trailing newline).
 * @param cues Millisecond-based cues.
 */
export function cuesToSrt(cues: Tx3gCue[]): string {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  const fmt = (ms: number) => {
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000); const u = ms - s * 1000;
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(u, 3)}`;
  };
  let i = 1, out = "";
  for (const c of cues) {
    out += `${i++}\n${fmt(c.startMs)} --> ${fmt(c.endMs)}\n${c.text}\n\n`;
  }
  return out.trimEnd() + "\n";
}