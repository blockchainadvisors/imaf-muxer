// src/codecs/srt.ts
import { SubtitleCue } from "../iso/subtitle";

const timeToMs = (t: string) => {
  // "HH:MM:SS,mmm"
  const m = t.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!m) return 0;
  return (+m[1])*3600000 + (+m[2])*60000 + (+m[3])*1000 + (+m[4]);
};

export function parseSrt(s: string): SubtitleCue[] {
  const blocks = s.replace(/\r/g,"").trim().split(/\n\n+/);
  const cues: SubtitleCue[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    if (lines.length < 2) continue;
    const time = lines[1];
    const m = time.match(/(.+?) --> (.+)/);
    if (!m) continue;
    const startMs = timeToMs(m[1].trim());
    const endMs = timeToMs(m[2].trim());
    const text = lines.slice(2).join("\n");
    cues.push({ startMs, endMs, text });
  }
  return cues;
}