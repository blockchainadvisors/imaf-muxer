// src/demux/demux-imaf-lib.ts (or wherever this lives)
import {
  readIma,
  buildAdtsStream, buildMp3Stream, buildWavFile, buildTx3g3gpFile,
  collectMpeg7Metas, decodeXmlBytes,
  mpeg7XmlToAlbum, mpeg7XmlToSong, mpeg7XmlToTrack,
  withAlbumDefaults, withSongDefaults, withTrackDefaults,
  extractImafSpecFromIso,
} from "../index";

// tiny concat for Uint8Array[]
const uconcat = (parts: Uint8Array[]) => {
  const len = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
};

/** Demux behavior flags and naming hints. */
export type DemuxOptions = {
  wantAudio?: boolean;
  wantText?: boolean;
  wantMeta?: boolean;
  wantImaf?: boolean;
  /** Debug tokens: "xml", "tree", "*" */
  debug?: string[];
  /** Base name for output artifacts (no extension). */
  basename?: string;
};

/** Named binary output. */
export type DemuxArtifact = { name: string; data: Uint8Array };
/** Demux result bundle. */
export type DemuxResult = {
  audio: DemuxArtifact[];
  text: DemuxArtifact[];
  metaJson?: { name: string; text: string };
  imafJson?: { name: string; text: string };
  counts: { audio: number; text: number };
  logs: string[];
};

const has = (set: Set<string>, t: string) => set.has("*") || set.has(t);

/**
 * Demux an ISO-BMFF/IMA buffer into audio files (AAC/MP3/WAV/raw),
 * tx3g 3GP files, and optional JSON sidecars.
 */
export function demuxImaToArtifacts(ab: ArrayBufferLike, opts: DemuxOptions = {}): DemuxResult {
  const wantAudio = opts.wantAudio !== false;
  const wantText  = opts.wantText  !== false;
  const wantMeta  = opts.wantMeta  !== false;
  const wantImaf  = opts.wantImaf  !== false;
  const base = (opts.basename && opts.basename.trim()) || "out";
  const dbgSet = new Set((opts.debug ?? []).map(s => s.trim()).filter(Boolean));
  const logs: string[] = [];

  // read streams (library handles interpretation; script handles FS)
  const { audio, texts } = readIma(ab, { debug: opts.debug });
  logs.push(`[dump] audio tracks: ${audio.length}  text tracks: ${texts.length}`);

  // ------------ audio dump ------------
  const audioFiles: DemuxArtifact[] = [];
  if (wantAudio) {
    let aIdx = 0;
    for (const a of audio) {
      aIdx++;
      const f2 = a.first2 ?? -1;
      const looksADTS = (f2 & 0xFFF6) === 0xFFF0;
      const looksMP3  = (f2 & 0xFFE0) === 0xFFE0;

      if (a.kind === "mp3" || looksMP3) {
        audioFiles.push({ name: `${base}.audio${aIdx}.mp3`, data: buildMp3Stream(a.frames) });
        continue;
      }
      if (a.kind === "aac") {
        const sr = a.sampleRate ?? 44100;
        const ch = a.channels ?? 2;
        audioFiles.push({
          name: `${base}.audio${aIdx}.aac`,
          data: buildAdtsStream(a.frames, { sr, ch, aot: a.aot ?? 2, first2: a.first2 })
        });
        continue;
      }
      if (a.kind === "lpcm" && a.sampleRate && a.channels && a.bits) {
        const raw = uconcat(a.frames);
        audioFiles.push({ name: `${base}.audio${aIdx}.wav`, data: buildWavFile(raw, a.sampleRate, a.channels, a.bits) });
        continue;
      }
      audioFiles.push({ name: `${base}.audio${aIdx}.bin`, data: uconcat(a.frames) });
    }
  }

  // ------------ text dump ------------
  const textFiles: DemuxArtifact[] = [];
  if (wantText) {
    let tIdx = 0;
    for (const t of texts) {
      tIdx++;
      const file = buildTx3g3gpFile(t.sampleEntry, t.frames, t.durations, t.timescale);
      textFiles.push({ name: `${base}.subs${tIdx}.${t.language || "und"}.3gp`, data: file });
    }
  }

  // ------------ MPEG-7 JSON ------------
  let metaOut: DemuxResult["metaJson"];
  if (wantMeta) {
    const metas = collectMpeg7Metas(ab);

    if (has(dbgSet, "xml")) {
      const p = (lab: string, xb?: Uint8Array) => {
        if (!xb?.length) return logs.push(`[xml] ${lab}: xml=0B`);
        const s = decodeXmlBytes(xb).trim().replace(/>\s+</g, "><");
        const tokens = s.replace(/</g, "\n<").split("\n").filter(Boolean);
        const out: string[] = []; let depth = 0;
        for (const raw of tokens) {
          const t = raw.trim();
          const isClose = /^<\//.test(t), isSelf = /\/>$/.test(t), isOpen = /^<[^/!?]/.test(t) && !isSelf;
          if (isClose) depth = Math.max(0, depth - 1);
          out.push(`${"  ".repeat(depth)}${t}`);
          if (isOpen) depth++;
          if (out.length >= 40) { out.push("  …"); break; }
        }
        logs.push(`[xml] ${lab}: xml=${xb.length}B\n${out.join("\n")}`);
      };
      metas.album ? p("album (top-level meta)", metas.album.xml) : logs.push("[xml] album: not found");
      metas.song ? p("song (moov/udta/meta)", metas.song.xml) : logs.push("[xml] song: not found");
      metas.tracks.length ? metas.tracks.forEach(t => p(`track#${t.index} (trak/udta/meta)`, t.xml))
                          : logs.push("[xml] tracks: none");
    }

    const albumXml = metas.album?.xml ? decodeXmlBytes(metas.album.xml) : "";
    const songXml  = metas.song ?.xml ? decodeXmlBytes(metas.song .xml) : "";

    const albumMetaFull = withAlbumDefaults(albumXml ? mpeg7XmlToAlbum(albumXml) : {});
    const songMetaFull  = withSongDefaults (songXml  ? mpeg7XmlToSong (songXml ) : {});

    const tracksMetaFull = metas.tracks.map(t => {
      const xml = t.xml ? decodeXmlBytes(t.xml) : "";
      const partial = xml ? mpeg7XmlToTrack(xml) : {};
      return { index: t.index, meta: withTrackDefaults(partial) };
    });

    const manifest = { album: albumMetaFull, song: songMetaFull, tracks: tracksMetaFull };
    metaOut = { name: `${base}.meta.json`, text: JSON.stringify(manifest, null, 2) };
  }

  // ------------ IMAF JSON ------------
  let imafOut: DemuxResult["imafJson"];
  if (wantImaf) {
    const spec = extractImafSpecFromIso(ab);
    if (spec) imafOut = { name: `${base}.imaf.json`, text: JSON.stringify(spec, null, 2) };
    else logs.push("ℹ️ No IMAF boxes found (grco/prco/ruco). Skipped imaf.json.");
  }

  return {
    audio: audioFiles,
    text: textFiles,
    metaJson: metaOut,
    imafJson: imafOut,
    counts: { audio: audio.length, text: texts.length },
    logs
  };
}