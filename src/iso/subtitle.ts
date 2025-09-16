// src/iso/subtitle.ts
import { u8, u16, u32, i16, str, box, full } from "./bytes";

/** One subtitle cue in milliseconds. */
export type SubtitleCue = {
  startMs: number;
  endMs: number;
  text: string;
  /** ISO-639-2/T (e.g., "eng"). */
  lang?: string;
};

/** In-memory tx3g track ready for muxing. */
export type MuxTx3gTrack = {
  kind: "tx3g";
  /** mdhd timescale (e.g., 1000). */
  timescale: number;
  /** mdhd duration in timescale units. */
  mdhdDuration: number;
  /** Encoded samples ([len][utf8]). */
  frames: Uint8Array[];
  /** Per-sample byte sizes. */
  sizes: number[];
  /** Per-sample durations in timescale units. */
  durations: number[];
  /** mdhd language (e.g., "eng"). */
  language?: string;
  /** Builds tx3g SampleEntry. */
  makeSampleEntry?: () => Uint8Array | Buffer;
};

// ---- Minimal tx3g sample entry (ISO/IEC 14496-17) ----

/**
 * Build a minimal tx3g TextSampleEntry.
 * @param opts Font, size, colour.
 * @returns 'tx3g' SampleEntry box.
 */
export function tx3gSampleEntry(opts?: {
  defaultFontId?: number; defaultFontName?: string;
  fontSize?: number; textColorRGBA?: [number, number, number, number];
}) {
  const fontId = opts?.defaultFontId ?? 1;
  const fontName = opts?.defaultFontName ?? "Sans-Serif";
  const fontSize = opts?.fontSize ?? 18;
  const [r, g, b, a] = opts?.textColorRGBA ?? [255, 255, 255, 255];

  // TextSampleEntry (tx3g) extends SampleEntry: 6 reserved + data_reference_index
  const sampleEntryHeader = Buffer.concat([Buffer.alloc(6, 0), u16(1)]);

  // DisplayFlags(4), hJust(1), vJust(1), bgRGBA(4)
  const display = Buffer.concat([u32(0), u8(1), u8(1), u8(r), u8(g), u8(b), u8(a)]);

  // BoxRecord (top,left,bottom,right) all i16
  const boxRecord = Buffer.concat([i16(0), i16(0), i16(0), i16(0)]);

  // StyleRecord: startChar(2), endChar(2), fontId(2), face(1), size(1), colorRGBA(4)
  const styleRecord = Buffer.concat([u16(0), u16(0xFFFF), u16(fontId), u8(0), u8(fontSize), u8(r), u8(g), u8(b), u8(a)]);

  // FontTableBox ('ftab')
  const fname = Buffer.from(fontName, "utf8");
  const ftabPayload = Buffer.concat([u16(1), u16(fontId), u8(fname.length), fname]);
  const ftab = box("ftab", ftabPayload);

  const payload = Buffer.concat([sampleEntryHeader, display, boxRecord, styleRecord, ftab]);
  return box("tx3g", payload);
}

// ---- Timed Text sample payload: [uint16 length][UTF-8 bytes] ----

/**
 * Encode a tx3g text sample as [u16 length][UTF-8].
 * @param text Cue text.
 */
export function encodeTx3gSample(text: string): Uint8Array {
  const body = Buffer.from(text, "utf8");
  const hdr = u16(body.length);
  return Buffer.concat([hdr, body]);
}

// ---- STTS from per-sample durations (run-length encoded) ----

/**
 * Build 'stts' from an array of per-sample durations.
 * @param durations Timescale units per sample.
 */
export function stts_from_durations(durations: number[]) {
  // coalesce runs of equal duration
  const entries: Array<{ count: number; delta: number }> = [];
  for (const d of durations) {
    const last = entries[entries.length - 1];
    if (last && last.delta === d) last.count++;
    else entries.push({ count: 1, delta: d >>> 0 });
  }
  const table = Buffer.alloc(entries.length * 8);
  entries.forEach((e, i) => {
    table.writeUInt32BE(e.count >>> 0, i * 8);
    table.writeUInt32BE(e.delta >>> 0, i * 8 + 4);
  });
  return box("stts", u32(0), u32(entries.length), table);
}

/** Single-entry 'stsd' wrapping a tx3g SampleEntry. */
export const stsd_tx3g = (entry: Uint8Array | Buffer) =>
  box("stsd", u32(0), u32(1), Buffer.isBuffer(entry) ? entry : Buffer.from(entry));

/** Trivial 'stsc' (1:1 mapping). */
export const stsc = () => box("stsc", u32(0), u32(1), u32(1), u32(1), u32(1));

/**
 * Build 'stsz' from sample sizes.
 * @param sizes Per-sample byte sizes.
 */
export const stsz = (sizes: number[]) => {
  const arr = Buffer.alloc(4 * sizes.length);
  sizes.forEach((s, i) => arr.writeUInt32BE(s >>> 0, i * 4));
  return box("stsz", u32(0), u32(0), u32(sizes.length), arr);
};

/**
 * Build 'stco' from absolute chunk offsets.
 * @param offsets File offsets (u32).
 */
export const stco = (offsets: number[]) => {
  const arr = Buffer.alloc(4 * offsets.length);
  offsets.forEach((o, i) => arr.writeUInt32BE(o >>> 0, i * 4));
  return box("stco", u32(0), u32(offsets.length), arr);
};

// ---- media boxes for text ----

/** Null media header ('nmhd'). */
export const nmhd = () => box("nmhd", u32(0));             // null media header for non-audio/video
/** 'hdlr' for Timed Text. */
export const hdlr_text = () => box("hdlr", u32(0), u32(0), str("text"), u32(0), u32(0), u32(0), Buffer.from("Timed Text\0", "ascii"));

/**
 * Build 'mdhd' (version 0).
 * @param timescale Timescale.
 * @param duration Duration in timescale units.
 * @param lang ISO-639-2/T (default 'und').
 */
export function mdhd(timescale: number, duration: number, lang?: string) {
  // version 0 mdhd: creation, modification, timescale, duration, lang(2b+pad), pre_defined
  const creation = u32(0), modification = u32(0);
  // ISO-639-2/T packed (5 bits per char), keep simple: default 'und'
  const l = (lang && lang.length === 3) ? lang : "und";
  const packed =
    ((l.charCodeAt(0) - 0x60) << 10) |
    ((l.charCodeAt(1) - 0x60) << 5) |
    ((l.charCodeAt(2) - 0x60) << 0);
  return box("mdhd", u32(0), creation, modification, u32(timescale >>> 0), u32(duration >>> 0), u16(packed), u16(0));
}

/**
 * Build 'stbl' for a tx3g track.
 * @param t Track data.
 * @param chunkOffsets Chunk offsets for stco.
 */
export function stbl_for_tx3g(t: MuxTx3gTrack, chunkOffsets: number[]) {
  const entry = t.makeSampleEntry ? (Buffer.isBuffer(t.makeSampleEntry()) ? t.makeSampleEntry() as Buffer : Buffer.from(t.makeSampleEntry()!)) : tx3gSampleEntry();
  return box("stbl",
    stsd_tx3g(entry),
    stts_from_durations(t.durations),
    stsc(),
    stsz(t.sizes),
    stco(chunkOffsets)
  );
}

/**
 * Build 'minf' for a tx3g track.
 * @param t Track data.
 * @param chunkOffsets Chunk offsets for stco.
 */
export function minf_for_tx3g(t: MuxTx3gTrack, chunkOffsets: number[]) {
  return box("minf", nmhd(), /* dref */ box("dinf", box("dref", u32(0), u32(1), box("url ", full(0, 1)))), stbl_for_tx3g(t, chunkOffsets));
}

/**
 * Build 'mdia' for a tx3g track.
 * @param t Track data.
 * @param chunkOffsets Chunk offsets for stco.
 */
export function mdia_for_tx3g(t: MuxTx3gTrack, chunkOffsets: number[]) {
  return box("mdia", mdhd(t.timescale, t.mdhdDuration, t.language), hdlr_text(), minf_for_tx3g(t, chunkOffsets));
}

// ---- Helper: build a tx3g track from cues ----

/**
 * Convert cues to a tx3g MuxTx3gTrack (samples + timings).
 * @param cues Subtitle cues.
 * @param opts { timescale, language, sampleEntry }.
 */
export function buildTx3gTrack(cues: SubtitleCue[], opts?: { timescale?: number; language?: string; sampleEntry?: Parameters<typeof tx3gSampleEntry>[0] }): MuxTx3gTrack {
  const timescale = opts?.timescale ?? 1000;
  const frames: Uint8Array[] = [];
  const sizes: number[] = [];
  const durations: number[] = [];

  for (const c of cues) {
    const d = Math.max(0, Math.round((c.endMs - c.startMs) * timescale / 1000));
    const f = encodeTx3gSample(c.text);
    frames.push(f);
    sizes.push(f.length);
    durations.push(d || 1);
  }

  const mdhdDuration = durations.reduce((a, b) => a + b, 0);
  return {
    kind: "tx3g",
    timescale,
    mdhdDuration,
    frames,
    sizes,
    durations,
    language: opts?.language ?? "und",
    makeSampleEntry: () => tx3gSampleEntry(opts?.sampleEntry)
  };
}