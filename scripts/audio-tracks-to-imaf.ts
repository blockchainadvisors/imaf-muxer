// src/audio-tracks-to-imaf.ts
import * as fs from "node:fs";
import * as path from "node:path";

import {
  composeImafToFile,
  parseAdtsFile, parseMp3File, parseWavFile, parseSaocElementaryStream,
  mp4aSampleEntry,
  mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML,
} from "../dist/imaf-mux.min.js";

import type { MuxTrack } from "../dist/imaf-mux.min.js";

function detectKind(p: string): "aac" | "mp3" | "pcm" | "saoc" {
  const q = p.toLowerCase();
  if (q.endsWith(".aac") || q.endsWith(".adts")) return "aac";
  if (q.endsWith(".mp3")) return "mp3";
  if (q.endsWith(".wav") || q.endsWith(".pcm")) return "pcm";
  if (q.endsWith(".saoc") || q.endsWith(".loas") || q.endsWith(".latm")) return "saoc";
  throw new Error(`Unknown audio format: ${p}`);
}

(async () => {
  const [, , outPath, ...inputs] = process.argv;
  if (!outPath || inputs.length === 0) {
    console.error("Usage: tsx src/audio-tracks-to-imaf.ts out.imaf <in1> <in2> ...");
    process.exit(1);
  }

  // Optional knobs via env (keeps CLI clean)
  const PCM_FRAME = Number(process.env.PCM_FRAME ?? 1024);
  const SAOC_ASC  = process.env.SAOC_ASC; // path to ASC if using SAOC

  // Parse → wrap into MuxTrack[]
  const tracks: MuxTrack[] = inputs.map((p) => {
    if (!fs.existsSync(p)) throw new Error(`Missing input: ${p}`);
    const kind = detectKind(p);
    const buf = fs.readFileSync(p);

    if (kind === "aac") {
      const a = parseAdtsFile(buf);
      return {
        sampleRate: a.sampleRate,
        mdhdDuration: a.mdhdDuration,
        frames: a.frames,
        sizes: a.sizes,
        frameCount: a.frameCount,
        samplesPerFrame: 1024,
        makeSampleEntry: () => mp4aSampleEntry(a.sampleRate, a.channelConfig, a.asc),
      };
    }

    if (kind === "mp3") {
      const m = parseMp3File(buf);
      return {
        sampleRate: m.sampleRate,
        mdhdDuration: m.frames.length * m.samplesPerFrame,
        frames: m.frames,
        sizes: m.sizes,
        frameCount: m.frames.length,
        samplesPerFrame: m.samplesPerFrame,   // 1152 or 576
        makeSampleEntry: () => Buffer.from(m.makeSampleEntry()),
      };
    }

    if (kind === "pcm") {
      const w = parseWavFile(buf, PCM_FRAME);
      return {
        sampleRate: w.sampleRate,
        mdhdDuration: w.frames.length * w.samplesPerFrame,
        frames: w.frames,
        sizes: w.sizes,
        frameCount: w.frames.length,
        samplesPerFrame: w.samplesPerFrame,
        makeSampleEntry: () => Buffer.from(w.makeSampleEntry()),
      };
    }

    if (kind === "saoc") {
      if (!SAOC_ASC) throw new Error(`SAOC input "${p}" requires SAOC_ASC env (path to ASC)`);
      const s = parseSaocElementaryStream(buf, { ascPath: SAOC_ASC });
      return {
        sampleRate: s.sampleRate,
        mdhdDuration: s.frames.length * s.samplesPerFrame,
        frames: s.frames,
        sizes: s.sizes,
        frameCount: s.frames.length,
        samplesPerFrame: s.samplesPerFrame ?? 1024,
        makeSampleEntry: () => Buffer.from(s.makeSampleEntry()),
      };
    }

    throw new Error("unreachable");
  });

  // Optional: keep your nice MPEG-7 titles (the composer has defaults if omitted)
  const albumXml = mpeg7AlbumXML({ title: "My Album", artist: "Various", genre: "Pop", releaseDate: "2025-09-01" });
  const songXml  = mpeg7SongXML({ title: "My Song", singer: "Alice",  releaseDate: "2025-09-01" });
  const perTrackXml = tracks.map((_, i) => mpeg7TrackXML({ title: `Audio Track ${i + 1}` }));

  // Compose & write file (layout = [ftyp][mdat][moov])
  composeImafToFile(outPath, tracks, {
    layout: "ftyp-mdat-moov",
    albumXml,
    songXml,
    perTrackXml,
    includeImaf: true,
  });

  console.log(`✅ Wrote ${path.resolve(outPath)} with ${tracks.length} audio track(s)`);
})();
