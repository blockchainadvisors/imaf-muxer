// src/demux/ima-reader.ts
// Pure ISO-BMFF reader for IMA files: no fs/path; exports helpers that return Buffers.
import { decodeXmlBytes } from "../iso/mpeg7";

const ENV_DEBUG = (typeof process !== "undefined" && (process as any).env?.IMA_DEBUG) ? (process as any).env.IMA_DEBUG as string : "";
const DEBUG = new Set(ENV_DEBUG.split(",").map(s => s.trim()).filter(Boolean));
const dbg = (ns: string, ...a: any[]) => { if (DEBUG.has("*") || DEBUG.has(ns)) console.log(`[${ns}]`, ...a); };
const fmtN = (n: number) => n.toLocaleString();

// ---- Core types & low-level readers ----
type Box = { type: string; start: number; size: number; header: number; end: number };
const dv = (ab: ArrayBufferLike) => new DataView(ab as ArrayBuffer);
const u8v = (ab: ArrayBufferLike, o: number, n: number) => new Uint8Array(ab as ArrayBuffer, o, n);
const be32 = (b: DataView, o: number) => b.getUint32(o, false);
const be16 = (b: DataView, o: number) => b.getUint16(o, false);
const be64 = (b: DataView, o: number) => { const hi = b.getUint32(o, false), lo = b.getUint32(o + 4, false); return hi * 2 ** 32 + lo; };
const fourcc = (ab: ArrayBufferLike, o: number) => new TextDecoder("ascii").decode(u8v(ab, o, 4));

function* boxes(ab: ArrayBufferLike, from = 0, to = (ab as ArrayBuffer).byteLength): Generator<Box> {
  const b = dv(ab); let off = from;
  while (off + 8 <= to) {
    let size = be32(b, off); const type = fourcc(ab, off + 4);
    let hdr = 8, end = off + size;
    if (size === 1) { size = Number(be64(b, off + 8)); hdr = 16; end = off + size; }
    if (size === 0) { end = to; size = end - off; }
    if (size < hdr || end > to) break;
    yield { type, start: off, size, header: hdr, end };
    off = end;
  }
}

function payloadStartForChildren(b: Box): number {
  // 'meta' is FullBox: children start after version/flags (4)
  return b.type === "meta" ? (b.start + b.header + 4) : (b.start + b.header);
}
function kids(ab: ArrayBufferLike, parent: Box): Box[] {
  return Array.from(boxes(ab, payloadStartForChildren(parent), parent.end));
}
function child(ab: ArrayBufferLike, parent: Box, typ: string): Box | undefined {
  for (const b of boxes(ab, payloadStartForChildren(parent), parent.end)) if (b.type === typ) return b;
  return undefined;
}
function findBoxDeep(ab: ArrayBufferLike, from: number, to: number, fourCC: string): { off: number, size: number } | undefined {
  const B = dv(ab); let p = from;
  while (p + 8 <= to) {
    let sz = B.getUint32(p, false); const typ = fourcc(ab, p + 4); let hdr = 8;
    if (sz === 1) { sz = Number((B.getUint32(p + 8, false) * 2 ** 32) + B.getUint32(p + 12, false)); hdr = 16; }
    if (sz === 0) sz = to - p;
    if (sz < hdr || p + sz > to) break;
    if (typ === fourCC) return { off: p, size: sz };
    const hit = findBoxDeep(ab, p + hdr, p + sz, fourCC); if (hit) return hit;
    p += sz;
  }
  return undefined;
}

// ---- Sample tables & media info ----
function readStts(ab: ArrayBufferLike, stts: Box): number[] {
  const b = dv(ab); let o = stts.start + stts.header + 4; const n = be32(b, o); o += 4;
  const d: number[] = []; for (let i = 0; i < n; i++) { const c = be32(b, o); o += 4; const dt = be32(b, o); o += 4; for (let k = 0; k < c; k++) d.push(dt); }
  return d;
}
type StscEntry = { first_chunk: number; samples_per_chunk: number; desc_index: number };
function readStsc(ab: ArrayBufferLike, stsc: Box): StscEntry[] {
  const b = dv(ab); let o = stsc.start + stsc.header + 4; const n = be32(b, o); o += 4;
  const e: StscEntry[] = []; for (let i = 0; i < n; i++) { e.push({ first_chunk: be32(b, o), samples_per_chunk: be32(b, o + 4), desc_index: be32(b, o + 8) }); o += 12; }
  return e;
}
function readStsz(ab: ArrayBufferLike, stsz: Box, hint?: number): number[] {
  const b = dv(ab); let o = stsz.start + stsz.header + 4;
  const defaultSize = be32(b, o); o += 4; const n = be32(b, o); o += 4; const m = hint ?? n;
  if (defaultSize !== 0) return Array(m).fill(defaultSize);
  const out = new Array<number>(m); for (let i = 0; i < m; i++) { out[i] = be32(b, o); o += 4; }
  return out;
}
function readChunkOffsets(ab: ArrayBufferLike, stco?: Box, co64?: Box): number[] {
  if (co64) { const b = dv(ab); let o = co64.start + co64.header + 4; const n = be32(b, o); o += 4; const a = new Array<number>(n);
    for (let i = 0; i < n; i++) { a[i] = Number(be64(b, o)); o += 8; } return a; }
  if (!stco) return []; const b = dv(ab); let o = stco.start + stco.header + 4; const n = be32(b, o); o += 4; const a = new Array<number>(n);
  for (let i = 0; i < n; i++) { a[i] = be32(b, o); o += 4; } return a;
}
function buildSampleOffsets(sizes: number[], chunkOffsets: number[], stscEntries: StscEntry[]): number[] {
  const spc: number[] = []; for (let c = 1, i = 0; c <= chunkOffsets.length; c++) { while (i + 1 < stscEntries.length && stscEntries[i + 1].first_chunk <= c) i++; spc[c - 1] = stscEntries[i]?.samples_per_chunk ?? 1; }
  const offs: number[] = []; let s = 0; for (let c = 0; c < chunkOffsets.length; c++) { let off = chunkOffsets[c], n = spc[c] ?? 1; for (let j = 0; j < n && s < sizes.length; j++, s++) { offs.push(off); off += sizes[s]; } }
  return offs;
}
function mdhdInfo(ab: ArrayBufferLike, mdhd: Box) {
  const b = dv(ab); const ver = u8v(ab, mdhd.start + mdhd.header, 1)[0];
  let o = mdhd.start + mdhd.header + 4; if (ver === 1) o += 16; else o += 8;
  const timescale = be32(b, o); o += 4;
  const duration = (ver === 1) ? Number(be64(b, o)) : be32(b, o); o += (ver === 1 ? 8 : 4);
  const lang = be16(b, o);
  const c1 = ((lang >> 10) & 31) + 0x60, c2 = ((lang >> 5) & 31) + 0x60, c3 = (lang & 31) + 0x60;
  return { timescale, duration, language: String.fromCharCode(c1, c2, c3) };
}
function handlerType(ab: ArrayBufferLike, hdlr: Box) { return fourcc(ab, hdlr.start + hdlr.header + 8); }

// ---- stsd entry (audio + tx3g) ----
type SampleEntry = { type: string; bytes: Uint8Array; esds?: Uint8Array; channelcount?: number; samplesize?: number; samplerate?: number };
function readStsdEntry(ab: ArrayBufferLike, stsd: Box): SampleEntry | undefined {
  const b = dv(ab); let off = stsd.start + stsd.header + 8; if (off + 8 > stsd.end) return;
  let size = be32(b, off), type = fourcc(ab, off + 4), hdr = 8;
  if (size === 1) { size = Number(be64(b, off + 8)); hdr = 16; }
  const entry: SampleEntry = { type, bytes: u8v(ab, off, size) };
  if (type !== "mp4a" && type !== "lpcm") return entry;

  const base = off + hdr + 8;
  const version = be16(b, base);
  const v0Fields = 20, v1Extra = 16, v2Extra = 36;
  const fieldsSize = version === 1 ? v0Fields + v1Extra : (version === 2 ? v0Fields + v2Extra : v0Fields);

  const ch = be16(b, base + 8);
  const ss = be16(b, base + 10);
  const sr1616 = be32(b, base + 16);
  entry.channelcount = ch || undefined;
  entry.samplesize = ss || undefined;
  entry.samplerate = (sr1616 >>> 16) || undefined;

  const entryEnd = off + size;
  const esdsBox = findBoxDeep(ab, base + fieldsSize, entryEnd, "esds");
  if (esdsBox) entry.esds = u8v(ab, esdsBox.off, esdsBox.size);

  if (!entry.channelcount) {
    const chanBox = findBoxDeep(ab, base + fieldsSize, entryEnd, "chan");
    if (chanBox) { const dvb = new DataView(ab as ArrayBuffer, chanBox.off, chanBox.size); const num = dvb.getUint32(8, false); if (num) entry.channelcount = num; }
  }
  dbg("stsd", `audio entry type=${type} ver=${version} sr=${entry.samplerate ?? "-"} ch=${entry.channelcount ?? "-"}`);
  return entry;
}

// ---- esds → ASC + OT ----
function parseEsdsAsc(esds?: Uint8Array): { asc?: Uint8Array; ot?: number } {
  if (!esds) return {};
  let o = 12; let ot: number | undefined;
  while (o + 2 <= esds.length) {
    const tag = esds[o++]; let len = 0;
    for (let i = 0; i < 4; i++) { const b = esds[o++]; len = (len << 7) | (b & 0x7F); if (!(b & 0x80)) break; }
    if (tag === 0x04 && len >= 1) ot = esds[o];
    if (tag === 0x05) { const asc = esds.subarray(o, o + len); return { asc, ot }; }
    o += len;
  }
  return { ot };
}

// ---- MPEG-7 meta collection + pretty XML ----
export type Mpeg7MetaSummary = {
  album?: { meta: Box; xml?: Uint8Array };
  song?: { meta: Box; xml?: Uint8Array };
  tracks: Array<{ index: number; meta: Box; xml?: Uint8Array }>;
};
function xmlBytesFromMeta(ab: ArrayBufferLike, meta: Box): Uint8Array | undefined {
  const x = child(ab, meta, "xml "); if (!x) return;
  const sz = x.end - (x.start + x.header); if (sz <= 0) return;
  return u8v(ab, x.start + x.header, sz);
}
function readMetaHandler(ab: ArrayBufferLike, meta: Box): { handler?: string; name?: string } {
  const h = child(ab, meta, "hdlr"); if (!h) return {};
  const handler = fourcc(ab, h.start + h.header + 8);
  let name: string | undefined;
  try {
    const start = h.start + h.header + 24;
    const raw = u8v(ab, start, Math.max(0, Math.min(h.end - start, 256)));
    const nul = raw.indexOf(0x00); const slice = nul >= 0 ? raw.subarray(0, nul) : raw;
    const s = new TextDecoder("utf-8", { fatal: false }).decode(slice).trim();
    if (s) name = s;
  } catch {}
  return { handler, name };
}
function metaLabel(ab: ArrayBufferLike, meta: Box): string {
  const { handler, name } = readMetaHandler(ab, meta);
  const xb = xmlBytesFromMeta(ab, meta);
  const parts: string[] = [];
  if (handler) parts.push(`handler=${handler}`);
  if (name) parts.push(`name="${name}"`);
  if (xb?.length) parts.push(`xml=${xb.length}B`);
  return parts.length ? ` [${parts.join(", ")}]` : "";
}
export function collectMpeg7Metas(ab: ArrayBufferLike): Mpeg7MetaSummary {
  const A = ab as ArrayBuffer; const out: Mpeg7MetaSummary = { tracks: [] };
  for (const b of boxes(A)) { if (b.type === "meta") { out.album = { meta: b, xml: xmlBytesFromMeta(A, b) }; break; } }
  let moov: Box | undefined; for (const b of boxes(A)) if (b.type === "moov") { moov = b; break; }
  if (!moov) return out;
  const udta = child(A, moov, "udta"); const moovMeta = udta && child(A, udta, "meta");
  if (moovMeta) out.song = { meta: moovMeta, xml: xmlBytesFromMeta(A, moovMeta) };
  const traks = kids(A, moov).filter(k => k.type === "trak");
  traks.forEach((trak, i) => {
    const tudta = child(A, trak, "udta"); const tmeta = tudta && child(A, tudta, "meta");
    if (tmeta) out.tracks.push({ index: i + 1, meta: tmeta, xml: xmlBytesFromMeta(A, tmeta) });
  });
  return out;
}

// export function decodeXmlBytes(xb: Uint8Array): string {
//   if (xb.length >= 2 && xb[0] === 0xFF && xb[1] === 0xFE) return new TextDecoder("utf-16le").decode(xb);
//   if (xb.length >= 2 && xb[0] === 0xFE && xb[1] === 0xFF) return new TextDecoder("utf-16be").decode(xb);
//   if (xb.length >= 3 && xb[0] === 0xEF && xb[1] === 0xBB && xb[2] === 0xBF) return new TextDecoder("utf-8").decode(xb);
//   if (xb.length >= 2 && xb[0] === 0x00) return new TextDecoder("utf-16be").decode(xb);
//   if (xb.length >= 2 && xb[1] === 0x00) return new TextDecoder("utf-16le").decode(xb);
//   return new TextDecoder("utf-8", { fatal: false }).decode(xb);
// }

function prettyXml(xml: string, opts?: { maxLines?: number; maxWidth?: number }): string {
  const maxLines = opts?.maxLines ?? 40; const maxWidth = opts?.maxWidth ?? 120;
  let s = xml.trim().replace(/>\s+</g, "><");
  const tokens = s.replace(/</g, "\n<").split("\n").filter(Boolean);
  const out: string[] = []; let depth = 0;
  for (const raw of tokens) {
    const t = raw.trim(); const isClose = /^<\//.test(t); const isSelf = /\/>$/.test(t); const isOpen = /^<[^/!?]/.test(t) && !isSelf;
    if (isClose) depth = Math.max(0, depth - 1);
    const line = `${"  ".repeat(depth)}${t}`;
    if (line.length <= maxWidth) out.push(line);
    else {
      const parts = line.split(/\s+/); let cur = "";
      for (const p of parts) {
        const add = cur ? cur + " " + p : p;
        if (add.length > maxWidth) { if (cur) out.push(cur); cur = "  ".repeat(depth + 1) + p; }
        else cur = add;
      }
      if (cur) out.push(cur);
    }
    if (isOpen) depth++;
    if (out.length >= maxLines) { out.push("  …"); break; }
  }
  return out.join("\n");
}

// ---- Tree view (concise) ----
export function dumpBoxTreeConcise(ab: ArrayBufferLike): string {
  const A = ab as ArrayBuffer, lines: string[] = [];
  for (const b of boxes(A)) {
    if (b.type === "moov") {
      const moovKids = kids(A, b);
      const counts: Record<string, number> = {};
      for (const k of moovKids) counts[k.type] = (counts[k.type] ?? 0) + 1;
      const summary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  ");
      lines.push(`moov @${fmtN(b.start)}  size=${fmtN(b.size)}  ${summary}`);

      const udta = moovKids.find(k => k.type === "udta");
      const moovMeta = udta && child(A, udta, "meta");
      if (moovMeta) lines.push(`  meta${metaLabel(A, moovMeta)}`);

      let tIdx = 0;
      for (const t of moovKids.filter(k => k.type === "trak")) {
        tIdx++;
        const mdia = child(A, t, "mdia");
        const hdlr = mdia && child(A, mdia, "hdlr");
        const stbl = mdia && child(A, child(A, mdia!, "minf")!, "stbl");
        const stsd = stbl && child(A, stbl, "stsd");
        const mdhd = mdia && child(A, mdia, "mdhd");
        const { timescale, language } = mdhd ? mdhdInfo(A, mdhd) : { timescale: 0, language: "und" };
        const entry = stsd && readStsdEntry(A, stsd);
        const stsz = stbl && child(A, stbl, "stsz");
        const samples = (stsz && readStsz(A, stsz))?.length ?? 0;
        const handler = hdlr ? handlerType(A, hdlr) : "????";
        const codec = entry?.type ?? "-";
        lines.push(`  trak#${tIdx} [${handler}] ${codec} ts=${timescale} samples=${fmtN(samples)} lang=${language}`);

        const tudta = child(A, t, "udta");
        const tmeta = tudta && child(A, tudta, "meta");
        if (tmeta) lines.push(`    meta${metaLabel(A, tmeta)}`);
      }
    } else if (b.type === "meta") {
      lines.push(`meta @${fmtN(b.start)} size=${fmtN(b.size)}${metaLabel(A, b)}`);
    } else if (b.type === "mdat") {
      lines.push(`mdat @${fmtN(b.start)} size=${fmtN(b.size)}`);
    } else {
      const nk = kids(A, b).length;
      lines.push(`${b.type} @${fmtN(b.start)} size=${fmtN(b.size)}${nk ? ` kids=${nk}` : ""}`);
    }
  }
  return lines.join("\n");
}

// ---- Public structs & reader ----
export type AudioDump = {
  kind: "aac" | "mp3" | "lpcm" | "raw";
  sampleRate?: number; channels?: number; bits?: number;
  frames: Uint8Array[]; sizes: number[];
  asc?: Uint8Array; aot?: number; ot?: number; first2?: number;
};
export type Tx3gDump = { sampleEntry: Uint8Array; sizes: number[]; durations: number[]; timescale: number; language: string; frames: Uint8Array[] };

export function readIma(ab: ArrayBufferLike) {
  dbg("ima", "Start readIma; bytes:", (ab as ArrayBuffer).byteLength);

  if (DEBUG.has("*") || DEBUG.has("tree")) console.log("[tree]\n" + dumpBoxTreeConcise(ab));
  if (DEBUG.has("*") || DEBUG.has("xml")) {
    const metas = collectMpeg7Metas(ab);
    const show = (label: string, xb?: Uint8Array) => {
      if (!xb || xb.length === 0) { console.log(`[xml] ${label}: xml=0B`); return; }
      const pretty = prettyXml(decodeXmlBytes(xb), { maxLines: 40, maxWidth: 110 });
      console.log(`[xml] ${label}: xml=${xb.length}B\n${pretty}`);
    };
    metas.album ? show("album (top-level meta)", metas.album.xml) : console.log("[xml] album: not found");
    metas.song  ? show("song (moov/udta/meta)", metas.song.xml)   : console.log("[xml] song: not found");
    metas.tracks.length ? metas.tracks.forEach(t => show(`track#${t.index} (trak/udta/meta)`, t.xml))
                        : console.log("[xml] tracks: none");
  }

  // find moov
  let moov: Box | undefined; for (const b of boxes(ab)) if (b.type === "moov") { moov = b; break; }
  if (!moov) throw new Error("moov not found");
  dbg("ima", "Found moov @", moov.start, "size", moov.size);

  const audio: AudioDump[] = []; const texts: Tx3gDump[] = [];
  const traks = kids(ab, moov).filter(k => k.type === "trak"); dbg("ima", "traks:", traks.length);

  for (const [tidx, trak] of traks.entries()) {
    dbg("trak", `trak#${tidx} @${trak.start} size=${trak.size}`);
    const mdia = child(ab, trak, "mdia"); if (!mdia) continue;
    const hdlr = child(ab, mdia, "hdlr"); if (!hdlr) continue;
    const htype = handlerType(ab, hdlr); dbg("trak", `trak#${tidx}: handler=${htype}`);

    const minf = child(ab, mdia, "minf"); const stbl = minf && child(ab, minf, "stbl"); if (!stbl) continue;
    const stsd = child(ab, stbl, "stsd"); if (!stsd) continue;
    const mdhd = child(ab, mdia, "mdhd"); if (!mdhd) continue;
    const { timescale, language } = mdhdInfo(ab, mdhd); dbg("stbl", `trak#${tidx}: timescale=${timescale}, lang=${language}`);

    const stts = child(ab, stbl, "stts"); const stsc = child(ab, stbl, "stsc"); const stsz = child(ab, stbl, "stsz");
    if (!stts || !stsc || !stsz) continue;
    const stco = child(ab, stbl, "stco"); const co64 = child(ab, stbl, "co64");

    const durations = readStts(ab, stts);
    const sizes = readStsz(ab, stsz);
    const chunkOffsets = readChunkOffsets(ab, stco, co64);
    const stscE = readStsc(ab, stsc);
    const offs = buildSampleOffsets(sizes, chunkOffsets, stscE);
    const samples = sizes.map((sz, i) => u8v(ab, offs[i], sz));

    const entry = readStsdEntry(ab, stsd); if (!entry) continue;
    dbg("trak", `trak#${tidx}: stsd.entry type=${entry.type} sr=${entry.samplerate ?? "-"} ch=${entry.channelcount ?? "-"}`);

    if (htype === "soun") {
      const { asc, ot } = parseEsdsAsc(entry.esds);
      const sr = entry.samplerate || timescale || 44100;
      const ch = entry.channelcount || 2;
      const first = samples[0] ?? new Uint8Array(0);
      const first2 = first.length >= 2 ? ((first[0] << 8) | first[1]) : undefined;
      dbg("trak", `trak#${tidx}: audio ot=${ot ?? "-"} ascLen=${asc?.length ?? 0} sr=${sr} ch=${ch}`);

      if (entry.type === "mp4a" && ot === 0x6B) {
        audio.push({ kind: "mp3", frames: samples, sizes, first2, ot });
      } else if (entry.type === "mp4a") {
        audio.push({ kind: "aac", sampleRate: sr, channels: ch, bits: 16, frames: samples, sizes, asc, aot: 2, ot, first2 });
      } else if (entry.type === "lpcm") {
        audio.push({ kind: "lpcm", sampleRate: sr, channels: ch, bits: entry.samplesize || 16, frames: samples, sizes, first2 });
      } else {
        audio.push({ kind: "raw", frames: samples, sizes, first2 });
      }
      continue;
    }

    if (htype === "text" || entry.type === "tx3g") {
      dbg("trak", `trak#${tidx}: tx3g samples=${sizes.length}`);
      texts.push({ sampleEntry: entry.bytes, sizes, durations, timescale, language, frames: samples });
    }
  }

  dbg("ima", `done readIma → audio=${audio.length}, text=${texts.length}`);
  return { audio, texts };
}

// ---- Audio & tx3g builders (return Buffers) ----
const SR_INDEX: Record<number, number> = { 96000: 0, 88200: 1, 64000: 2, 48000: 3, 44100: 4, 32000: 5, 24000: 6, 22050: 7, 16000: 8, 12000: 9, 11025: 10, 8000: 11, 7350: 12 };
function adtsHeader(aot: number, sr: number, ch: number, frameLen: number) {
  const prof = (aot - 1) & 0x3; const srx = SR_INDEX[sr] ?? 4; const len = frameLen + 7;
  const h = new Uint8Array(7);
  h[0] = 0xFF; h[1] = 0xF1; h[2] = ((prof & 3) << 6) | ((srx & 0xF) << 2) | ((ch >> 2) & 1);
  h[3] = ((ch & 3) << 6) | ((len >> 11) & 0x03); h[4] = (len >> 3) & 0xFF; h[5] = ((len & 7) << 5) | 0x1F; h[6] = 0xFC;
  return h;
}
export function buildAdtsStream(frames: Uint8Array[], opts: { sr: number; ch: number; aot?: number; first2?: number }) {
  const looksADTS = opts.first2 !== undefined && ((opts.first2 & 0xFFF6) === 0xFFF0);
  if (looksADTS) return Buffer.concat(frames.map(f => Buffer.from(f)));
  const aot = opts.aot ?? 2; const out: Buffer[] = [];
  for (const f of frames) { out.push(Buffer.from(adtsHeader(aot, opts.sr, opts.ch, f.byteLength))); out.push(Buffer.from(f)); }
  return Buffer.concat(out);
}
export function buildMp3Stream(frames: Uint8Array[]) {
  return Buffer.concat(frames.map(f => Buffer.from(f)));
}
export function buildWavFile(pcm: Uint8Array, sr: number, ch: number, bits: number) {
  const byteRate = sr * ch * (bits / 8); const blockAlign = ch * (bits / 8);
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8);
  hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(ch, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(byteRate, 28);
  hdr.writeUInt16LE(blockAlign, 32); hdr.writeUInt16LE(bits, 34);
  hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([hdr, Buffer.from(pcm)]);
}

// tiny box utils for tx3g .3gp
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16BE(n >>> 0, 0); return b; }
function str4(s: string) { return Buffer.from(s, "ascii"); }
function box(type: string, ...payload: Buffer[]): Buffer { const body = Buffer.concat(payload); return Buffer.concat([u32(8 + body.length), str4(type), body]); }

export function buildTx3g3gpFile(sampleEntry: Uint8Array, frames: Uint8Array[], durations: number[], timescale: number) {
  const sizes = frames.map(f => f.byteLength);
  const mdatPayload = Buffer.concat(frames.map(f => Buffer.from(f)));
  const mdat = box("mdat", mdatPayload);

  const base = 8; const offsets: number[] = []; let cur = base;
  for (const s of sizes) { offsets.push(cur); cur += s; }

  const stsd = box("stsd", u32(0), u32(1), Buffer.from(sampleEntry));
  const sttsEntries: Buffer[] = [];
  if (durations.length) {
    let run = 1, last = durations[0];
    for (let i = 1; i < durations.length; i++) {
      if (durations[i] === last) run++; else { sttsEntries.push(u32(run), u32(last)); run = 1; last = durations[i]; }
    }
    sttsEntries.push(u32(run), u32(last));
  }
  const stts = box("stts", u32(0), u32(sttsEntries.length / 2), Buffer.concat(sttsEntries));
  const stsc = box("stsc", u32(0), u32(1), u32(1), u32(1), u32(1));
  const stszArr = Buffer.alloc(4 * sizes.length); sizes.forEach((s, i) => stszArr.writeUInt32BE(s >>> 0, i * 4));
  const stsz = box("stsz", u32(0), u32(0), u32(sizes.length), stszArr);
  const stcoArr = Buffer.alloc(4 * offsets.length); offsets.forEach((o, i) => stcoArr.writeUInt32BE(o >>> 0, i * 4));
  const stco = box("stco", u32(0), u32(offsets.length), stcoArr);
  const dref = box("dref", u32(0), u32(1), box("url ", Buffer.from([0, 0, 0, 1])));
  const dinf = box("dinf", dref);
  const nmhd = box("nmhd", u32(0));
  const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
  const minf = box("minf", nmhd, dinf, stbl);

  const mdhd = box("mdhd", u32(0), u32(0), u32(0), u32(timescale), u32(durations.reduce((a, b) => a + b, 0)), u16(0x55C4), u16(0));
  const hdlr = box("hdlr", u32(0), u32(0), str4("text"), u32(0), u32(0), u32(0), Buffer.from("Timed Text\0", "ascii"));
  const mdia = box("mdia", mdhd, hdlr, minf);

  const mvhdTs = 1000;
  const mvhdDur = Math.round((durations.reduce((a, b) => a + b, 0) / timescale) * mvhdTs);
  const mvhd = box("mvhd", u32(0), u32(0), u32(0), u32(mvhdTs), u32(mvhdDur),
    u32(0x00010000), u16(0x0100), u16(0), Buffer.alloc(10, 0),
    Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(24, 0), u32(2));
  const tkhd = box("tkhd", Buffer.from([0, 0, 0, 7]), u32(0), u32(0), u32(1), u32(0),
    u32(mvhdDur), Buffer.alloc(8, 0), u16(0), u16(0), u16(0), u16(0),
    Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    u32(0), u32(0));
  const trak = box("trak", tkhd, mdia);
  const moov = box("moov", mvhd, trak);
  const ftyp = box("ftyp", Buffer.from("isom", "ascii"), u32(0x200), Buffer.from("isom3gp6mp41", "ascii"));

  return Buffer.concat([ftyp, mdat, moov]);
}