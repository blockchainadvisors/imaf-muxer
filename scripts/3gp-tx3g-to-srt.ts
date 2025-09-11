#!/usr/bin/env tsx
import * as fs from "node:fs";
import * as path from "node:path";
import { extractAllTx3gTracks, cuesToSrt } from "../dist/imaf-mux.min.js";

const [, , inPath, outBaseArg] = process.argv;
if (!inPath) {
  console.error("Usage: tsx scripts/3gp-tx3g-to-srt.ts input.3gp [outBase]");
  process.exit(1);
}

const buf = fs.readFileSync(inPath);
const { tracks, cues } = extractAllTx3gTracks(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

if (!tracks.length) {
  console.error("No tx3g/text tracks found.");
  process.exit(2);
}

const base = outBaseArg ?? path.basename(inPath, path.extname(inPath));
cues.forEach((cueList, i) => {
  const lang = tracks[i].language || "und";
  const outPath = `${base}.tx3g${i + 1}.${lang}.srt`;
  fs.writeFileSync(outPath, cuesToSrt(cueList), "utf8");
  console.log(`✓ Wrote ${outPath} (${cueList.length} cues)`);
});
