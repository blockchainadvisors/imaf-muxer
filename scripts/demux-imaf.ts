import * as fs from "node:fs";
import * as path from "node:path";
import {
  demuxImaToArtifacts,
  type DemuxOptions
} from "../dist/imaf-mux.min.js";

// --- tiny arg parser (no deps) ---
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
    const mEq = a.match(/^--([^=]+)=(.*)$/);
    if (mEq) { push(mEq[1], mEq[2]); continue; }
    const mLong = a.match(/^--(.+)$/);
    if (mLong) {
      const k = mLong[1];
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { push(k, next); i++; }
      else push(k, true);
      continue;
    }
    const mShort = a.match(/^-([A-Za-z])$/);
    if (mShort) {
      const k = mShort[1];
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
  tsx scripts/demux-imaf.ts --in <input.ima> [--out-dir <dir>] [--no-audio] [--no-text] [--no-meta] [--no-imaf] [--debug ... ]

Options:
  --in, -i         Path to input .ima file (required)
  --out-dir, -d    Output directory (default: <input>_extracted)
  --no-audio       Skip dumping audio tracks
  --no-text        Skip dumping tx3g text tracks
  --no-meta        Skip writing meta.json
  --no-imaf        Skip writing imaf.json

Debug:
  --debug=<list>   Comma-separated tokens, e.g. "xml", "tree", or "*"
  --debug-xml      Shorthand for enabling XML pretty-print
  --debug-tree     Shorthand for enabling box tree dump

  --help, -h       Show this help`
  );
  process.exit(0);
}

// ---- parse CLI ----
const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) showHelpAndExit();

const inPath = (args.in as string) || (args.i as string) || (Array.isArray(args._) ? args._[0] : undefined);
if (!inPath) {
  console.error("error: --in <input.ima> is required\n(use --help for usage)");
  process.exit(1);
}
const outDir =
  (args["out-dir"] as string) ||
  (args.d as string) ||
  path.basename(inPath, path.extname(inPath)) + "_extracted";

fs.mkdirSync(outDir, { recursive: true });

// FS: read input once
const buf = fs.readFileSync(inPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// map debug args (scripts do not interpret beyond tokenizing)
const tokens = new Set<string>();
const dbgArg = args.debug;
if (typeof dbgArg === "string") dbgArg.split(",").map(s => s.trim()).filter(Boolean).forEach(t => tokens.add(t));
else if (Array.isArray(dbgArg)) dbgArg.forEach(s => s.split(",").map(x => x.trim()).filter(Boolean).forEach(t => tokens.add(t)));
else if (dbgArg === true) tokens.add("*");
if (args["debug-xml"]) tokens.add("xml");
if (args["debug-tree"]) tokens.add("tree");

// Library call → artifacts (no FS inside the library)
const demuxOpts: DemuxOptions = {
  wantAudio: !args["no-audio"],
  wantText:  !args["no-text"],
  wantMeta:  !args["no-meta"],
  wantImaf:  !args["no-imaf"],
  debug: Array.from(tokens),
  basename: path.basename(inPath, path.extname(inPath)),
};

const res = demuxImaToArtifacts(ab, demuxOpts);

// Print logs (if any)
res.logs.forEach(line => console.log(line));

// FS: write artifacts
for (const f of res.audio) fs.writeFileSync(path.join(outDir, f.name), f.data);
for (const f of res.text)  fs.writeFileSync(path.join(outDir, f.name), f.data);
if (res.metaJson) fs.writeFileSync(path.join(outDir, res.metaJson.name), res.metaJson.text);
if (res.imafJson) fs.writeFileSync(path.join(outDir, res.imafJson.name), res.imafJson.text);

console.log(`✓ Extracted to ${outDir}`);