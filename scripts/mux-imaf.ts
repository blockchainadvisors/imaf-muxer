// scripts/mux-imaf.ts
import * as fs from "node:fs";
import * as path from "node:path";

import {
  composeImaf,
  buildTracksFromInputs, normalizeCliMeta, resolveIncludeImaf,
  type InputFile, type MuxBuildOptions, type ComposeOptions
} from "../dist/imaf-mux.min.js";

// --- tiny arg parser ---
type ArgMap = Record<string, string | boolean | string[]>;
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

function showHelpAndExit() {
  console.log(
    `Usage:
  tsx scripts/mux-imaf.ts --out <out.ima> [--in <file> ...] [--subtitle <srt|3gp> ...]
                          [--meta <file|json>] [--imaf <file|json>] [--layout <L>]
                          [--pcm-frame <N>] [--saoc-asc <path>]

Options:
  --out, -o            Output .ima path (required)
  --in, -i             Input file(s): .aac/.adts, .mp3, .wav|.pcm, .saoc|.loas|.latm
  --subtitle           Extra subtitle file(s) (.srt or .3gp/.mp4). May repeat
  --meta               JSON file path or inline JSON (album/song/tracks) — parsed by library
  --imaf               JSON file path or inline JSON (groups/presets/rules) — parsed by library
  --layout             Container layout (default: ftyp-mdat-moov)
  --include-imaf       (legacy) boolean flag if set; ignored when --imaf is provided
  --pcm-frame          PCM frame size for WAV/PCM inputs (default: 1024)
  --saoc-asc           Path to SAOC AudioSpecificConfig when inputs include .saoc
  --help, -h           Show this help`
  );
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) showHelpAndExit();

const outPath = (args.out as string) || (args.o as string);
if (!outPath) {
  console.error("error: --out <out.ima> is required\n(use --help for usage)");
  process.exit(1);
}

// Collect input lists (no interpretation)
const toArr = (v: unknown) => v == null ? [] : (Array.isArray(v) ? v.map(String) : [String(v)]);
const argIn = toArr(args.in).concat(toArr(args.i));
const positionals = toArr(args._);
const inputPaths = [...argIn, ...positionals];
const subtitlePaths = toArr(args.subtitle);

// FS-only: read files (binary → Buffer)
const readIfFile = (p: string): Buffer | undefined => {
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p); }
  catch { /* ignore */ }
  return undefined;
};

const makeInputs = (paths: string[]): InputFile[] =>
  paths.map(name => ({ name, buf: readIfFile(name)! }))
    .filter(x => x.buf instanceof Buffer);

if (inputPaths.length === 0 && subtitlePaths.length === 0) {
  console.error("No inputs provided. Use --in <file> (may repeat) and/or --subtitle <file>");
  process.exit(1);
}

const inputFiles: InputFile[] = makeInputs(inputPaths);
const subtitleFiles: InputFile[] = makeInputs(subtitlePaths);

// FS-only: load argument payloads as plain strings (scripts don’t parse)
const readArgPayload = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  if (/^\s*\{/.test(v)) return v;                 // inline JSON
  const buf = readIfFile(v);
  return buf ? buf.toString("utf8") : v;          // if file exists, read; else treat as inline
};

// meta/imaf raw texts (library parses/normalizes)
let metaJsonText: string | undefined;
if (typeof args.meta === "string") metaJsonText = readArgPayload(args.meta);
if (Array.isArray(args.meta) && args.meta.length) metaJsonText = readArgPayload(args.meta[args.meta.length - 1]);

let imafJsonText: string | undefined;
if (typeof args.imaf === "string") imafJsonText = readArgPayload(args.imaf);
if (Array.isArray(args.imaf) && args.imaf.length) imafJsonText = readArgPayload(args.imaf[args.imaf.length - 1]);

// build opts pass-through (scripts do not interpret)
const buildOpts: MuxBuildOptions = {
  pcmFrame: args["pcm-frame"] ? Number(args["pcm-frame"]) : undefined,
  saocAscPath: typeof args["saoc-asc"] === "string" ? args["saoc-asc"] : undefined,
};

// Everything else: library work
const { tracks, subtitleTracks } = buildTracksFromInputs(inputFiles, subtitleFiles, buildOpts);
const { albumMeta, songMeta, perTrackMeta } = normalizeCliMeta(metaJsonText);

const legacyIncludeImaf =
  (args["include-imaf"] === true) || (args["include-imaf"] === "true");

const includeImaf = resolveIncludeImaf(imafJsonText, legacyIncludeImaf);
const layout = args.layout === "ftyp-moov-mdat" ? "ftyp-moov-mdat" : "ftyp-mdat-moov";

const opts: ComposeOptions = {
  layout,
  includeImaf,
  subtitleTracks,
  // structured meta (library converted)
  albumMeta, songMeta, perTrackMeta,
};

// FS: write file
const absOut = path.resolve(outPath);
const out = composeImaf(tracks, opts);
fs.writeFileSync(absOut, out);
console.log(`✅ Wrote ${absOut} with ${tracks.length} audio and ${subtitleTracks.length} subtitle track(s)`);
