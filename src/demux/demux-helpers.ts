import {
  readIma,
  buildAdtsStream, buildMp3Stream, buildWavFile, buildTx3g3gpFile,
  collectMpeg7Metas, decodeXmlBytes,
  mpeg7XmlToAlbum, mpeg7XmlToSong, mpeg7XmlToTrack,
  withAlbumDefaults, withSongDefaults, withTrackDefaults,
  extractImafSpecFromIso,
} from "../index"; // adjust path to your actual export barrel

/** Demux behavior flags and naming hints. */
export type DemuxOptions = {
  /** Extract audio tracks (default true). */
  wantAudio?: boolean;
  /** Extract text (tx3g) tracks (default true). */
  wantText?: boolean;
  /** Collect MPEG-7 metadata to JSON (default true). */
  wantMeta?: boolean;
  /** Extract IMAF spec boxes to JSON (default true). */
  wantImaf?: boolean;
  /** Debug tokens: "xml", "tree", "*" */
  debug?: string[];
  /** Base name for output artifacts (no extension). */
  basename?: string;
};

/** Named binary output. */
export type DemuxArtifact = { name: string; data: Buffer };
/** Demux result bundle. */
export type DemuxResult = {
  audio: DemuxArtifact[];
  text: DemuxArtifact[];
  metaJson?: { name: string; text: string };
  imafJson?: { name: string; text: string };
  counts: { audio: number; text: number };
  logs: string[]; // debug/info lines caller may print
};

// lightweight debug gate; no process.env reads here
const has = (set: Set<string>, t: string) => set.has("*") || set.has(t);

/**
 * Demux an ISO-BMFF/IMA buffer into audio files (AAC/MP3/WAV/raw), tx3g 3GP files, and optional JSON sidecars.
 * @param ab ISO-BMFF bytes.
 * @param opts See DemuxOptions.
 * @returns Artifacts, counts, and debug logs.
 */
export function demuxImaToArtifacts(ab: ArrayBufferLike, opts: DemuxOptions = {}): DemuxResult {
  const wantAudio = opts.wantAudio !== false;
  const wantText = opts.wantText !== false;
  const wantMeta = opts.wantMeta !== false;
  const wantImaf = opts.wantImaf !== false;
  const base = (opts.basename && opts.basename.trim()) || "out";
  const dbgSet = new Set((opts.debug ?? []).map(s => s.trim()).filter(Boolean));
  const logs: string[] = [];

  // read streams
  const { audio, texts } = readIma(ab, { debug: opts.debug }); // updated signature below
  logs.push(`[dump] audio tracks: ${audio.length}  text tracks: ${texts.length}`);

  const audioFiles: DemuxArtifact[] = [];
  if (wantAudio) {
    let aIdx = 0;
    for (const a of audio) {
      aIdx++;
      const f2 = a.first2 ?? -1;
      const looksADTS = (f2 & 0xFFF6) === 0xFFF0;
      const looksMP3 = (f2 & 0xFFE0) === 0xFFE0;

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
        const raw = Buffer.concat(a.frames.map(f => Buffer.from(f)));
        audioFiles.push({ name: `${base}.audio${aIdx}.wav`, data: buildWavFile(raw, a.sampleRate, a.channels, a.bits) });
        continue;
      }
      audioFiles.push({ name: `${base}.audio${aIdx}.bin`, data: Buffer.concat(a.frames.map(f => Buffer.from(f))) });
    }
  }

  const textFiles: DemuxArtifact[] = [];
  if (wantText) {
    let tIdx = 0;
    for (const t of texts) {
      tIdx++;
      const file = buildTx3g3gpFile(t.sampleEntry, t.frames, t.durations, t.timescale);
      textFiles.push({ name: `${base}.subs${tIdx}.${t.language || "und"}.3gp`, data: file });
    }
  }

  let metaOut: DemuxResult["metaJson"];
  if (wantMeta) {
    const metas = collectMpeg7Metas(ab);
    if (has(dbgSet, "xml")) {
      const p = (lab: string, xb?: Uint8Array) => {
        if (!xb?.length) return logs.push(`[xml] ${lab}: xml=0B`);
        const pretty = (() => {
          // mirror prettyXml behavior without importing it here
          const s = decodeXmlBytes(xb).trim().replace(/>\s+</g, "><");
          const tokens = s.replace(/</g, "\n<").split("\n").filter(Boolean);
          const out: string[] = []; let depth = 0;
          for (const raw of tokens) {
            const t = raw.trim(); const isClose = /^<\//.test(t); const isSelf = /\/>$/.test(t); const isOpen = /^<[^/!?]/.test(t) && !isSelf;
            if (isClose) depth = Math.max(0, depth - 1);
            out.push(`${"  ".repeat(depth)}${t}`);
            if (isOpen) depth++;
            if (out.length >= 40) { out.push("  …"); break; }
          }
          return out.join("\n");
        })();
        logs.push(`[xml] ${lab}: xml=${xb.length}B\n${pretty}`);
      };
      metas.album ? p("album (top-level meta)", metas.album.xml) : logs.push("[xml] album: not found");
      metas.song ? p("song (moov/udta/meta)", metas.song.xml) : logs.push("[xml] song: not found");
      if (metas.tracks.length) metas.tracks.forEach(t => p(`track#${t.index} (trak/udta/meta)`, t.xml));
      else logs.push("[xml] tracks: none");
    }

    const albumXml = metas.album?.xml ? decodeXmlBytes(metas.album.xml) : "";
    const songXml = metas.song?.xml ? decodeXmlBytes(metas.song.xml) : "";

    const albumMetaFull = withAlbumDefaults(albumXml ? mpeg7XmlToAlbum(albumXml) : {});
    const songMetaFull = withSongDefaults(songXml ? mpeg7XmlToSong(songXml) : {});

    const tracksMetaFull = metas.tracks.map(t => {
      const xml = t.xml ? decodeXmlBytes(t.xml) : "";
      const partial = xml ? mpeg7XmlToTrack(xml) : {};
      return { index: t.index, meta: withTrackDefaults(partial) };
    });

    const manifest = { album: albumMetaFull, song: songMetaFull, tracks: tracksMetaFull };
    metaOut = { name: `${base}.meta.json`, text: JSON.stringify(manifest, null, 2) };
  }

  let imafOut: DemuxResult["imafJson"];
  if (wantImaf) {
    const spec = extractImafSpecFromIso(ab);
    if (spec) {
      imafOut = { name: `${base}.imaf.json`, text: JSON.stringify(spec, null, 2) };
    } else {
      logs.push("ℹ️ No IMAF boxes found (grco/prco/ruco). Skipped imaf.json.");
    }
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
