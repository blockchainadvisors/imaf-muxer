// scripts/ima-extract.ts
import * as fs from "node:fs";
import * as path from "node:path";
import {
  readIma, 
  buildAdtsStream, buildMp3Stream, buildWavFile, buildTx3g3gpFile, 
  collectMpeg7Metas, decodeXmlBytes, 
  mpeg7XmlToAlbum, mpeg7XmlToSong, mpeg7XmlToTrack,
  withAlbumDefaults, withSongDefaults, withTrackDefaults
} from "../dist/imaf-mux.min.js";

const [, , inPath, outDirArg] = process.argv;
if (!inPath) {
  console.error("Usage: tsx scripts/ima-extract.ts input.ima [outDir]");
  process.exit(1);
}

const outDir = outDirArg ?? path.basename(inPath, path.extname(inPath)) + "_extracted";
fs.mkdirSync(outDir, { recursive: true });

const buf = fs.readFileSync(inPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const { audio, texts } = readIma(ab);
console.log(`[dump] audio tracks: ${audio.length} text tracks: ${texts.length}`);

// ------------ audio dump (unchanged) ------------
let aIdx = 0;
for (const a of audio) {
  aIdx++;
  const f2 = a.first2 ?? -1;
  const looksADTS = (f2 & 0xFFF6) === 0xFFF0;
  const looksMP3  = (f2 & 0xFFE0) === 0xFFE0;

  if (a.kind === "mp3" || looksMP3) {
    fs.writeFileSync(path.join(outDir, `audio${aIdx}.mp3`), buildMp3Stream(a.frames));
    continue;
  }

  if (a.kind === "aac") {
    const sr = a.sampleRate ?? 44100;
    const ch = a.channels ?? 2;
    fs.writeFileSync(
      path.join(outDir, `audio${aIdx}.aac`),
      buildAdtsStream(a.frames, { sr, ch, aot: a.aot ?? 2, first2: a.first2 })
    );
    continue;
  }

  if (a.kind === "lpcm" && a.sampleRate && a.channels && a.bits) {
    const raw = Buffer.concat(a.frames.map(f => Buffer.from(f)));
    fs.writeFileSync(path.join(outDir, `audio${aIdx}.wav`), buildWavFile(raw, a.sampleRate, a.channels, a.bits));
    continue;
  }

  fs.writeFileSync(path.join(outDir, `audio${aIdx}.bin`), Buffer.concat(a.frames.map(f => Buffer.from(f))));
}

// ------------ text dump (unchanged) ------------
let tIdx = 0;
for (const t of texts) {
  tIdx++;
  const file = buildTx3g3gpFile(t.sampleEntry, t.frames, t.durations, t.timescale);
  fs.writeFileSync(path.join(outDir, `subs${tIdx}.${t.language || "und"}.3gp`), file);
}

// ------------ NEW: MPEG-7 JSON (schema-complete) ------------
const metas = collectMpeg7Metas(ab);

const albumXml = metas.album?.xml ? decodeXmlBytes(metas.album.xml) : "";
const songXml  = metas.song?.xml  ? decodeXmlBytes(metas.song.xml)  : "";

const albumMetaFull = withAlbumDefaults(albumXml ? mpeg7XmlToAlbum(albumXml) : {});
const songMetaFull  = withSongDefaults (songXml  ? mpeg7XmlToSong(songXml)   : {});

const tracksMetaFull = metas.tracks.map(t => {
  const xml = t.xml ? decodeXmlBytes(t.xml) : "";
  const partial = xml ? mpeg7XmlToTrack(xml) : {};
  return { index: t.index, meta: withTrackDefaults(partial) };
});

const manifest = {
  album: albumMetaFull,
  song:  songMetaFull,
  tracks: tracksMetaFull
};

fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(manifest, null, 2));

console.log(`✓ Extracted ${audio.length} audio track(s) and ${texts.length} text track(s) to ${outDir}`);
console.log(`✓ Wrote schema-complete MPEG-7 JSON → ${path.join(outDir, "meta.json")}`);