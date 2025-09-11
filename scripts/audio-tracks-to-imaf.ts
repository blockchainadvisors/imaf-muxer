// src/audio-tracks-to-imaf.ts
import * as fs from "node:fs";
import * as path from "node:path";

import {
  composeImaf,
  parseAdtsFile, parseMp3File, parseWavFile, parseSaocElementaryStream,
  parseSrt, buildTx3gTrack, extractTx3gMuxTracks,
  mp4aSampleEntry,
  mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML,
  type MuxTrack, type MuxTx3gTrack, type ComposeOptions
} from "../dist/imaf-mux.min.js";

type AlbumMeta = { title: string; artist: string; genre?: string; releaseDate?: string; production?: string; publisher?: string; copyright?: string; image?: string; siteUrl?: string; };
type SongMeta = { title: string; singer: string; composer?: string; lyricist?: string; genre?: string; releaseDate?: string; isrc?: string; cdTrackNumber?: number; production?: string; publisher?: string; copyright?: string; image?: string; siteUrl?: string; };
type TrackMeta = { title: string; performerName?: string; recordingDateTime?: string };

const req = <T>(v: T | undefined, name: string): T => { if (v == null) throw new Error(`--meta.${name} is required`); return v; };

const toAlbumMeta = (x: any): AlbumMeta => ({
  title: req(x?.title, "album.title"),
  artist: req(x?.artist, "album.artist"),
  genre: x?.genre, releaseDate: x?.releaseDate, production: x?.production,
  publisher: x?.publisher, copyright: x?.copyright, image: x?.image, siteUrl: x?.siteUrl,
});

const toSongMeta = (x: any): SongMeta => ({
  title: req(x?.title, "song.title"),
  singer: req(x?.singer, "song.singer"),
  composer: x?.composer, lyricist: x?.lyricist, genre: x?.genre, releaseDate: x?.releaseDate,
  isrc: x?.isrc, cdTrackNumber: x?.cdTrackNumber, production: x?.production, publisher: x?.publisher,
  copyright: x?.copyright, image: x?.image, siteUrl: x?.siteUrl,
});

const toTrackMeta = (x: any, i: number): TrackMeta => ({
  title: x?.title ?? `Track ${i + 1}`,
  performerName: x?.performerName, recordingDateTime: x?.recordingDateTime,
});

type CliMeta = {
  album?: Record<string, any>;
  song?: Record<string, any>;
  tracks?: Array<Record<string, any>>;
};

function detectKind(p: string): "aac" | "mp3" | "pcm" | "saoc" | "srt" | "3gp" {
  const q = p.toLowerCase();
  if (q.endsWith(".aac") || q.endsWith(".adts")) return "aac";
  if (q.endsWith(".mp3")) return "mp3";
  if (q.endsWith(".wav") || q.endsWith(".pcm")) return "pcm";
  if (q.endsWith(".saoc") || q.endsWith(".loas") || q.endsWith(".latm")) return "saoc";
  if (q.endsWith(".srt")) return "srt";
  if (q.endsWith(".3gp") || q.endsWith(".mp4")) return "3gp";
  throw new Error(`Unknown input format: ${p}`);
}

function guessLangFromFilename(p: string): string | undefined {
  const m = p.toLowerCase().match(/\.([a-z]{2,3})\.srt$/);
  return m?.[1];
}

function composeImafToFile(outPath: string, tracks: MuxTrack[], opts?: ComposeOptions) {
  const out = composeImaf(tracks, opts);
  fs.writeFileSync(outPath, out);
}

// --- NEW: parse --meta (file path or inline JSON) ---
function parseCliMeta(argv: string[]): { meta?: CliMeta; rest: string[] } {
  const rest: string[] = [];
  let meta: CliMeta | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--meta") {
      const v = argv[++i];
      if (!v) throw new Error("--meta missing value");
      meta = loadMeta(v);
    } else if (a.startsWith("--meta=")) {
      meta = loadMeta(a.slice(7));
    } else {
      rest.push(a);
    }
  }
  return { meta, rest };

  function loadMeta(val: string): CliMeta {
    // if looks like a JSON object, parse; else read file
    if (/^\s*\{/.test(val)) return JSON.parse(val) as CliMeta;
    const txt = fs.readFileSync(val, "utf8");
    return JSON.parse(txt) as CliMeta;
  }
}

(async () => {
  // argv: node tsx script out.imaf [--meta <json|file>] <inputs...>
  const [, , outPathRaw, ...tail] = process.argv;
  if (!outPathRaw) {
    console.error("Usage: tsx src/audio-tracks-to-imaf.ts out.imaf [--meta meta.json|--meta='{\"album\":...}'] <in...>");
    process.exit(1);
  }

  const { meta, rest } = parseCliMeta(tail);
  if (rest.length === 0) {
    console.error("No inputs provided.");
    process.exit(1);
  }

  const outPath = outPathRaw;
  const PCM_FRAME = Number(process.env.PCM_FRAME ?? 1024);
  const SAOC_ASC = process.env.SAOC_ASC;

  const tracks: MuxTrack[] = [];
  const subtitleTracks: MuxTx3gTrack[] = [];

  for (const p of rest) {
    if (!fs.existsSync(p)) throw new Error(`Missing input: ${p}`);
    const kind = detectKind(p);
    const buf = fs.readFileSync(p);

    if (kind === "aac") {
      const a = parseAdtsFile(buf);
      tracks.push({
        sampleRate: a.sampleRate,
        mdhdDuration: a.mdhdDuration,
        frames: a.frames,
        sizes: a.sizes,
        frameCount: a.frameCount,
        samplesPerFrame: 1024,
        makeSampleEntry: () => mp4aSampleEntry(a.sampleRate, a.channelConfig, a.asc),
      });
      continue;
    }

    if (kind === "mp3") {
      const m = parseMp3File(buf);
      tracks.push({
        sampleRate: m.sampleRate,
        mdhdDuration: m.frames.length * m.samplesPerFrame,
        frames: m.frames,
        sizes: m.sizes,
        frameCount: m.frames.length,
        samplesPerFrame: m.samplesPerFrame,
        makeSampleEntry: () => Buffer.from(m.makeSampleEntry()),
      });
      continue;
    }

    if (kind === "pcm") {
      const w = parseWavFile(buf, PCM_FRAME);
      tracks.push({
        sampleRate: w.sampleRate,
        mdhdDuration: w.frames.length * w.samplesPerFrame,
        frames: w.frames,
        sizes: w.sizes,
        frameCount: w.frames.length,
        samplesPerFrame: w.samplesPerFrame,
        makeSampleEntry: () => Buffer.from(w.makeSampleEntry()),
      });
      continue;
    }

    if (kind === "saoc") {
      if (!SAOC_ASC) throw new Error(`SAOC input "${p}" requires SAOC_ASC env (path to ASC)`);
      const s = parseSaocElementaryStream(buf, { ascPath: SAOC_ASC });
      tracks.push({
        sampleRate: s.sampleRate,
        mdhdDuration: s.frames.length * s.samplesPerFrame,
        frames: s.frames,
        sizes: s.sizes,
        frameCount: s.frames.length,
        samplesPerFrame: s.samplesPerFrame ?? 1024,
        makeSampleEntry: () => Buffer.from(s.makeSampleEntry()),
      });
      continue;
    }

    if (kind === "srt") {
      const cues = parseSrt(buf.toString("utf8"));
      const lang = guessLangFromFilename(p) ?? "eng";
      subtitleTracks.push(buildTx3gTrack(cues, { timescale: 1000, language: lang }));
      continue;
    }

    if (kind === "3gp") {
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const muxSubs = extractTx3gMuxTracks(ab);
      if (!muxSubs.length) throw new Error(`No tx3g tracks found in ${p}`);
      subtitleTracks.push(...muxSubs);
      continue;
    }
  }

  // --- JSON → MPEG-7 XML (only build when provided) ---
  const albumXml = meta?.album ? mpeg7AlbumXML(toAlbumMeta(meta.album)) : undefined;
  const songXml = meta?.song ? mpeg7SongXML(toSongMeta(meta.song)) : undefined;

  let perTrackXml: string[] | undefined;
  if (meta?.tracks?.length) {
    perTrackXml = tracks.map((_, i) => mpeg7TrackXML(toTrackMeta(meta.tracks![i], i)));
  }

  composeImafToFile(outPath, tracks, {
    layout: "ftyp-mdat-moov",
    albumXml,
    songXml,
    perTrackXml,
    includeImaf: true,
    subtitleTracks,
  });

  console.log(`✅ Wrote ${path.resolve(outPath)} with ${tracks.length} audio and ${subtitleTracks.length} subtitle track(s)`);
})();
