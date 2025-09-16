//scripts/3gp-tx3g-to-srt.ts
/** CLI: extract tx3g subtitles from 3GP/MP4 and write SRT files. */
import * as fs from "node:fs";
import * as path from "node:path";
import { extractAllTx3gTracks, cuesToSrt } from "../dist/imaf-mux.min.js";

// tiny arg parser
/** Parsed CLI flags; "_" holds positionals. */
type ArgMap = Record<string, string | boolean | string[]>;

/**
 * Parse argv into flags and positionals.
 * @param argv Process args sans node/script.
 * @returns Arg map with strings/booleans/arrays as given.
 */
function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  const push = (k: string, v: string | boolean = true) => {
    if (out[k] === undefined) out[k] = v;
    else if (Array.isArray(out[k])) (out[k] as string[]).push(String(v));
    else out[k] = [String(out[k]), String(v)];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) { push("_", a); continue; }
    if (a === "--") { argv.slice(i + 1).forEach(x => push("_", x)); break; }
    const me = a.match(/^--([^=]+)=(.*)$/);
    if (me) { push(me[1], me[2]); continue; }
    const ml = a.match(/^--(.+)$/);
    if (ml) {
      const k = ml[1];
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { push(k, next); i++; }
      else push(k, true);
      continue;
    }
    const ms = a.match(/^-([A-Za-z])$/);
    if (ms) {
      const k = ms[1];
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { push(k, next); i++; }
      else push(k, true);
      continue;
    }
  }
  return out;
}

/** Print usage help and exit(0). */
function showHelpAndExit() {
  console.log(
`Usage:
  tsx scripts/3gp-tx3g-to-srt.ts --in <input.3gp|.mp4> [--out-base <base>]

Options:
  --in, -i        Input 3GP/MP4 containing tx3g
  --out-base, -o  Base filename for outputs (default: <input basename>)
  --help, -h      Show help`
  );
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) showHelpAndExit();

/** Resolve input path from --in/-i or first positional. */
const inPath = (args.in as string) || (args.i as string) || (Array.isArray(args._) ? args._[0] : undefined);
if (!inPath) {
  console.error("error: --in <input.3gp|.mp4> is required\n(use --help for usage)");
  process.exit(1);
}

const buf = fs.readFileSync(inPath);
const { tracks, cues } = extractAllTx3gTracks(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

if (!tracks.length) {
  console.error("No tx3g/text tracks found.");
  process.exit(2);
}

/** Output base name (defaults to input basename). */
const base =
  (args["out-base"] as string) ||
  (args.o as string) ||
  path.basename(inPath, path.extname(inPath));

cues.forEach((cueList, i) => {
  const lang = tracks[i].language || "und";
  const outPath = `${base}.tx3g${i + 1}.${lang}.srt`;
  fs.writeFileSync(outPath, cuesToSrt(cueList), "utf8");
  console.log(`✓ Wrote ${outPath} (${cueList.length} cues)`);
});