// src/mux/mux-helpers.ts
import { box, u32, u16, str, concat } from "../iso/bytes";
import {
  parseAdtsFile, parseMp3File, parseWavFile, parseSaocElementaryStream,
  parseSrt, buildTx3gTrack, extractTx3gMuxTracks,
  mp4aSampleEntry,
  type MuxTrack, type MuxTx3gTrack,
} from "../index";

/** Named buffer input (browser-safe). */
export type InputFile = { name: string; buf: Uint8Array };

/** Muxer build options. */
export type MuxBuildOptions = {
  /** PCM samples per frame (default 1024). */
  pcmFrame?: number;
  /** SAOC ASC bytes when .saoc is present (browser-safe). */
  saocAscBytes?: Uint8Array;
};

export type NormalizedAlbumMeta = {
  title: string; artist: string; genre?: string; releaseDate?: string;
  production?: string; publisher?: string; copyright?: string;
  coverUrl?: string; siteUrl?: string;
};
export type NormalizedSongMeta = {
  title: string; singer?: string; composer?: string; lyricist?: string;
  genre?: string; releaseDate?: string; production?: string; publisher?: string;
  copyright?: string; isrc?: string; cdTrackNo?: string; imageUrl?: string; siteUrl?: string;
};
export type NormalizedTrackMeta = {
  title?: string; performer?: string; recordedAt?: string;
};

/** Composer-ready metadata bundle. */
export type NormalizedMeta = {
  albumMeta?: NormalizedAlbumMeta;
  songMeta?: NormalizedSongMeta;
  perTrackMeta?: NormalizedTrackMeta[];
};
/**
 * helper: pack ISO-639-2/T (3 letters) into mdhd's 15-bit field
 * @param lang ISO-639-2/T code (3 letters); "und" if missing/invalid
 * @returns packed 15-bit value
 */
function packIso639(lang?: string): number {
  const l = (lang && /^[a-z]{3}$/i.test(lang)) ? lang.toLowerCase() : "und";
  const a = l.charCodeAt(0) - 0x60;
  const b = l.charCodeAt(1) - 0x60;
  const c = l.charCodeAt(2) - 0x60;
  return ((a & 31) << 10) | ((b & 31) << 5) | (c & 31);
}

/**
 * Detect input kind from filename.
 * @param filename Path or basename.
 */
export function detectKind(filename: string): "aac" | "mp3" | "pcm" | "saoc" | "srt" | "3gp" {
  const q = filename.toLowerCase();
  if (q.endsWith(".aac") || q.endsWith(".adts")) return "aac";
  if (q.endsWith(".mp3")) return "mp3";
  if (q.endsWith(".wav") || q.endsWith(".pcm")) return "pcm";
  if (q.endsWith(".saoc") || q.endsWith(".loas") || q.endsWith(".latm")) return "saoc";
  if (q.endsWith(".srt")) return "srt";
  if (q.endsWith(".3gp") || q.endsWith(".mp4")) return "3gp";
  throw new Error(`Unknown input format: ${filename}`);
}

/**
 * Guess language (ISO-639-2) from *.xx.srt suffix.
 * @param filename Subtitle filename.
 */
export function guessLangFromFilename(filename: string): string | undefined {
  const m = filename.toLowerCase().match(/\.([a-z]{2,3})\.srt$/);
  return m?.[1];
}

/**
 * Build audio + subtitle tracks from buffers.
 * @param inputs Audio/containers.
 * @param subtitles SRT/3GP subtitle sources.
 * @param opts Frame sizes, SAOC ASC bytes.
 */
export function buildTracksFromInputs(
  inputs: InputFile[],
  subtitles: InputFile[],
  opts: MuxBuildOptions = {}
): { tracks: MuxTrack[]; subtitleTracks: MuxTx3gTrack[] } {
  const PCM_FRAME = Number(opts.pcmFrame ?? 1024);
  const SAOC_ASC_BYTES = opts.saocAscBytes;

  const tracks: MuxTrack[] = [];
  const subtitleTracks: MuxTx3gTrack[] = [];

  const handleOne = (f: InputFile) => {
    const kind = detectKind(f.name);

    if (kind === "aac") {
      const a = parseAdtsFile(f.buf);
      tracks.push({
        sampleRate: a.sampleRate,
        mdhdDuration: a.mdhdDuration,
        frames: a.frames,
        sizes: a.sizes,
        frameCount: a.frameCount,
        samplesPerFrame: 1024,
        makeSampleEntry: () => mp4aSampleEntry(a.sampleRate, a.channelConfig, a.asc),
      });
      return;
    }

    if (kind === "mp3") {
      const m = parseMp3File(f.buf);
      tracks.push({
        sampleRate: m.sampleRate,
        mdhdDuration: m.frames.length * m.samplesPerFrame,
        frames: m.frames,
        sizes: m.sizes,
        frameCount: m.frames.length,
        samplesPerFrame: m.samplesPerFrame,
        makeSampleEntry: () => m.makeSampleEntry(),
      });
      return;
    }

    if (kind === "pcm") {
      const w = parseWavFile(f.buf, PCM_FRAME);
      tracks.push({
        sampleRate: w.sampleRate,
        mdhdDuration: w.frames.length * w.samplesPerFrame,
        frames: w.frames,
        sizes: w.sizes,
        frameCount: w.frames.length,
        samplesPerFrame: w.samplesPerFrame,
        makeSampleEntry: () => w.makeSampleEntry(),
      });
      return;
    }

    if (kind === "saoc") {
      if (!SAOC_ASC_BYTES) throw new Error(`SAOC input "${f.name}" requires saocAscBytes (AudioSpecificConfig)`);
      const s = parseSaocElementaryStream(f.buf, { ascBytes: SAOC_ASC_BYTES });
      tracks.push({
        sampleRate: s.sampleRate,
        mdhdDuration: s.frames.length * s.samplesPerFrame,
        frames: s.frames,
        sizes: s.sizes,
        frameCount: s.frames.length,
        samplesPerFrame: s.samplesPerFrame ?? 1024,
        makeSampleEntry: () => s.makeSampleEntry(),
      });
      return;
    }

    if (kind === "srt") {
      const text = new TextDecoder("utf-8").decode(f.buf);
      const cues = parseSrt(text);
      const lang = guessLangFromFilename(f.name) ?? "eng";
      subtitleTracks.push(buildTx3gTrack(cues, { timescale: 1000, language: lang }));
      return;
    }

    if (kind === "3gp") {
      const ab = f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.byteLength);
      const muxSubs = extractTx3gMuxTracks(ab);
      if (!muxSubs.length) throw new Error(`No tx3g tracks found in ${f.name}`);
      subtitleTracks.push(...muxSubs);
      return;
    }
  };

  inputs.forEach(handleOne);
  subtitles.forEach(handleOne);
  return { tracks, subtitleTracks };
}

/**
 * Parse CLI JSON meta and normalize for composer.
 * @param metaJsonText Raw JSON string or undefined.
 */
export function normalizeCliMeta(metaJsonText?: string): NormalizedMeta {
  if (!metaJsonText || !metaJsonText.trim()) return {};

  // Intentionally parse here (library, not the script):
  const raw = JSON.parse(metaJsonText) as any;

  const albumRaw = raw?.album;
  const songRaw = raw?.song;
  const tracksRaw = Array.isArray(raw?.tracks) ? raw.tracks : undefined;

  const albumMeta = albumRaw ? {
    title: albumRaw.title,
    artist: albumRaw.artist,
    genre: albumRaw.genre,
    releaseDate: albumRaw.releaseDate,
    production: albumRaw.production,
    publisher: albumRaw.publisher,
    copyright: albumRaw.copyright,
    coverUrl: albumRaw.coverUrl ?? albumRaw.image ?? undefined,
    siteUrl: albumRaw.siteUrl,
  } as NormalizedAlbumMeta : undefined;

  const songMeta = songRaw ? {
    title: songRaw.title,
    singer: songRaw.singer,
    composer: songRaw.composer,
    lyricist: songRaw.lyricist,
    genre: songRaw.genre,
    releaseDate: songRaw.releaseDate,
    production: songRaw.production,
    publisher: songRaw.publisher,
    copyright: songRaw.copyright,
    isrc: songRaw.isrc,
    cdTrackNo: (songRaw.cdTrackNo ?? songRaw.cdTrackNumber)?.toString(),
    imageUrl: songRaw.imageUrl ?? songRaw.image ?? undefined,
    siteUrl: songRaw.siteUrl,
  } as NormalizedSongMeta : undefined;

  const perTrackMeta = tracksRaw?.map((t: any, i: number) => {
    const src = (t && typeof t === "object" && "meta" in t) ? t.meta : t;
    return {
      title: src?.title ?? `Track ${i + 1}`,
      performer: src?.performer ?? src?.performerName,
      recordedAt: src?.recordedAt ?? src?.recordingDateTime,
    } as NormalizedTrackMeta;
  });

  return { albumMeta, songMeta, perTrackMeta };
}

/**
 * Resolve includeImaf input: JSON text takes precedence; else legacy boolean.
 * @returns boolean | string | undefined
 */
export function resolveIncludeImaf(imafJsonText?: string, legacyIncludeImaf?: boolean): boolean | string | undefined {
  if (imafJsonText != null) return imafJsonText;   // keep JSON text as-is (composer parses)
  if (legacyIncludeImaf != null) return Boolean(legacyIncludeImaf);
  return undefined;
}

// ---- Audio & tx3g builders (return Uint8Array) ----

/** ADTS sampling-rate indices. */
const SR_INDEX: Record<number, number> = { 96000: 0, 88200: 1, 64000: 2, 48000: 3, 44100: 4, 32000: 5, 24000: 6, 22050: 7, 16000: 8, 12000: 9, 11025: 10, 8000: 11, 7350: 12 };
/** Build a 7-byte ADTS header for an AAC frame len. */
function adtsHeader(aot: number, sr: number, ch: number, frameLen: number) {
  const prof = (aot - 1) & 0x3; const srx = SR_INDEX[sr] ?? 4; const len = frameLen + 7;
  const h = new Uint8Array(7);
  h[0] = 0xFF; h[1] = 0xF1; h[2] = ((prof & 3) << 6) | ((srx & 0xF) << 2) | ((ch >> 2) & 1);
  h[3] = ((ch & 3) << 6) | ((len >> 11) & 0x03); h[4] = (len >> 3) & 0xFF; h[5] = ((len & 7) << 5) | 0x1F; h[6] = 0xFC;
  return h;
}

/** Wrap raw AAC frames with ADTS headers (no-op if already ADTS). */
export function buildAdtsStream(frames: Uint8Array[], opts: { sr: number; ch: number; aot?: number; first2?: number }): Uint8Array {
  const looksADTS = opts.first2 !== undefined && ((opts.first2 & 0xFFF6) === 0xFFF0);
  if (looksADTS) return concat(...frames);
  const aot = opts.aot ?? 2;
  const parts: Uint8Array[] = [];
  for (const f of frames) { parts.push(adtsHeader(aot, opts.sr, opts.ch, f.byteLength)); parts.push(f); }
  return concat(...parts);
}

/** Concatenate MP3 frames. */
export function buildMp3Stream(frames: Uint8Array[]): Uint8Array {
  return concat(...frames);
}

/** Build a minimal PCM WAV file from raw PCM. */
export function buildWavFile(pcm: Uint8Array, sr: number, ch: number, bits: number): Uint8Array {
  const byteRate = sr * ch * (bits / 8); const blockAlign = ch * (bits / 8);
  const hdr = new Uint8Array(44);
  const dvh = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
  // "RIFF"
  hdr[0] = 0x52; hdr[1] = 0x49; hdr[2] = 0x46; hdr[3] = 0x46;
  dvh.setUint32(4, 36 + pcm.length, true);
  // "WAVE"
  hdr[8] = 0x57; hdr[9] = 0x41; hdr[10] = 0x56; hdr[11] = 0x45;
  // "fmt "
  hdr[12] = 0x66; hdr[13] = 0x6d; hdr[14] = 0x74; hdr[15] = 0x20;
  dvh.setUint32(16, 16, true);              // fmt chunk size
  dvh.setUint16(20, 1, true);               // PCM
  dvh.setUint16(22, ch, true);
  dvh.setUint32(24, sr, true);
  dvh.setUint32(28, byteRate, true);
  dvh.setUint16(32, blockAlign, true);
  dvh.setUint16(34, bits, true);
  // "data"
  hdr[36] = 0x64; hdr[37] = 0x61; hdr[38] = 0x74; hdr[39] = 0x61;
  dvh.setUint32(40, pcm.length, true);
  return concat(hdr, pcm);
}

/**
 * Build a tiny 3GP file containing a single tx3g track.
 * @param sampleEntry tx3g SampleEntry.
 * @param frames Encoded samples.
 * @param durations Per-sample durations (timescale units).
 * @param timescale mdhd timescale.
 * @param language ISO-639-2 language code (default "und").
 */
export function buildTx3g3gpFile(
  sampleEntry: Uint8Array,
  frames: Uint8Array[],
  durations: number[],
  timescale: number,
  language?: string
): Uint8Array {
  const sizes = frames.map(f => f.byteLength);

  // ftyp first so stco offsets are absolute
  const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom3gp6mp41"));

  // mdat
  const mdatPayload = concat(...frames);
  const mdat = box("mdat", mdatPayload);

  // absolute stco offsets (file layout: ftyp | mdat | moov)
  const base = ftyp.byteLength + 8;
  const offsets: number[] = [];
  let cur = base;
  for (const s of sizes) { offsets.push(cur); cur += s; }

  // stbl
  const stsd = box("stsd", u32(0), u32(1), sampleEntry);
  const sttsEntries: Uint8Array[] = [];
  if (durations.length) {
    let run = 1, last = durations[0];
    for (let i = 1; i < durations.length; i++) {
      if (durations[i] === last) run++;
      else { sttsEntries.push(u32(run), u32(last)); run = 1; last = durations[i]; }
    }
    sttsEntries.push(u32(run), u32(last));
  }
  const stts = box("stts", u32(0), u32(sttsEntries.length / 2), sttsEntries.length ? concat(...sttsEntries) : new Uint8Array(0));
  const stsc = box("stsc", u32(0), u32(1), u32(1), u32(1), u32(1));
  const stszArr = new Uint8Array(4 * sizes.length);
  const dvsz = new DataView(stszArr.buffer);
  sizes.forEach((s, i) => dvsz.setUint32(i * 4, s >>> 0, false));
  const stsz = box("stsz", u32(0), u32(0), u32(sizes.length), stszArr);
  const stcoArr = new Uint8Array(4 * offsets.length);
  const dvco = new DataView(stcoArr.buffer);
  offsets.forEach((o, i) => dvco.setUint32(i * 4, o >>> 0, false));
  const stco = box("stco", u32(0), u32(offsets.length), stcoArr);
  const dref = box("dref", u32(0), u32(1), box("url ", new Uint8Array([0,0,0,1])));
  const dinf = box("dinf", dref);
  const nmhd = box("nmhd", u32(0));
  const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
  const minf = box("minf", nmhd, dinf, stbl);

  // mdia with language
  const langPacked = packIso639(language);
  const mdhd = box(
    "mdhd",
    u32(0), u32(0), u32(0),
    u32(timescale),
    u32(durations.reduce((a,b)=>a+b,0)),
    u16(langPacked),          // <— language
    u16(0)
  );
  const hdlr = box("hdlr", u32(0), u32(0), str("text"), u32(0), u32(0), u32(0), str("Timed Text\0"));
  const mdia = box("mdia", mdhd, hdlr, minf);

  // moov (same as before)
  const mvhdTs = 1000;
  const mvhdDur = Math.round((durations.reduce((a,b)=>a+b,0) / timescale) * mvhdTs);
  const MATRIX = new Uint8Array([
    0x00,0x01,0x00,0x00, 0,0,0,0, 0,0,0,0,
    0,0,0,0, 0x00,0x01,0x00,0x00, 0,0,0,0,
    0,0,0,0, 0,0,0,0, 0x40,0,0,0
  ]);
  const mvhd = box("mvhd",
    u32(0), u32(0), u32(0),
    u32(mvhdTs), u32(mvhdDur),
    u32(0x00010000), u16(0x0100), u16(0),
    u32(0), u32(0),
    MATRIX,
    new Uint8Array(24), u32(2)
  );
  const tkhdFlags = new Uint8Array([0,0,0,7]);
  const TK_MATRIX = new Uint8Array([
    0,1,0,0, 0,0,0,0, 0,0,0,0,
    0,0,0,0, 0,1,0,0, 0,0,0,0,
    0,0,0,0, 0,0,0,0, 0,1,0,0
  ]);
  const tkhd = box("tkhd",
    tkhdFlags, u32(0), u32(0), u32(1), u32(0),
    u32(mvhdDur), new Uint8Array(8), u16(0), u16(0), u16(0), u16(0),
    TK_MATRIX, u32(0), u32(0)
  );
  const trak = box("trak", tkhd, mdia);
  const moov = box("moov", mvhd, trak);

  return concat(ftyp, mdat, moov);
}
