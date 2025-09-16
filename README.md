# IMAF Muxer / Demuxer — Installation & Usage

**Live API reference:** [https://blockchainadvisors.github.io/imaf-muxer/api/](https://blockchainadvisors.github.io/imaf-muxer/api/)

This project provides a **pure TypeScript** IMAF (ISO/IEC 23000-12) muxer/demuxer with MPEG-7 metadata support and minimal ISO-BMFF builders. It can:

* **Mux** multiple audio sources (AAC/ADTS, MP3, WAV/PCM; **SAOC experimental**) and optional **tx3g** subtitles into a single `.imaf` (MP4) file, embedding **MPEG-7 XML** (album / song / track).
* **Demux** `.imaf`/`.mp4` back to original streams, extract **MPEG-7** as JSON with schema-complete defaults, and convert **tx3g** ⇄ **SRT**.

> Works fully in Node.js (no native deps). Optional tools (MP4Box, FFmpeg) help with validation and auxiliary conversions.

---

## 1) Prerequisites

### Required

* **Node.js 20.x** or newer
  Recommended via **nvm**:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  source ~/.nvm/nvm.sh
  nvm install 20
  nvm use 20
  node -v
  ```
* **npm**

  ```bash
  corepack enable
  corepack prepare npm@latest --activate
  npm -v
  ```

### Optional (handy for inspection)

* **FFmpeg** — [https://ffmpeg.org/](https://ffmpeg.org/)
* **MP4Box (GPAC)** — [https://gpac.io/](https://gpac.io/)

---

## 2) Clone & Install

```bash
git clone https://github.com/blockchainadvisors/imaf-muxer.git
cd imaf-muxer

npm install
npm run build
```

> Want to run TS directly? Use **tsx**:
>
> ```bash
> npx tsx scripts/mux-imaf.ts --help
> ```

---

## 3) CLI Scripts

This repo ships three CLIs (TypeScript, runnable with `npx tsx …`):

### `scripts/mux-imaf.ts` — build an .imaf (MP4) file

```bash
npx tsx scripts/mux-imaf.ts --out <out.ima> [--in <file> ...] [--subtitle <srt|3gp> ...] \
                            [--meta <file|json>] [--imaf <file|json>] [--layout <L>] \
                            [--pcm-frame <N>] [--saoc-asc <path>]
```

* Inputs: `.aac/.adts`, `.mp3`, `.wav|.pcm`, `.saoc|.loas|.latm`
* Subtitles: `.srt` (converted to tx3g) or `.3gp/.mp4` with existing `tx3g`
* `--meta`: JSON string/file (album/song/tracks). Library normalizes fields.
* `--imaf`: JSON string/file (groups/presets/rules). Omit to use defaults.
* `--layout`: `ftyp-mdat-moov` (default) or `ftyp-moov-mdat`
* `--saoc-asc`: path to SAOC AudioSpecificConfig (required if SAOC input present)

### `scripts/demux-imaf.ts` — extract streams + metadata

```bash
npx tsx scripts/demux-imaf.ts --in <input.ima> [--out-dir <dir>] \
                              [--no-audio] [--no-text] [--no-meta] [--no-imaf] \
                              [--debug-xml] [--debug-tree] [--debug=*|xml,tree]
```

Outputs:

* Audio files (`.aac`, `.mp3`, `.wav`, or `.bin`)
* Timed-text as `.3gp` with `tx3g`
* `*.meta.json`: MPEG-7 expanded JSON (album/song/track) with defaults
* `*.imaf.json`: groups/presets/rules, if IMAF boxes present

### `scripts/3gp-tx3g-to-srt.ts` — convert tx3g → SRT

```bash
npx tsx scripts/3gp-tx3g-to-srt.ts --in <file.3gp|.mp4> [--out-base <base>]
```

Writes one `.srt` per tx3g track with language in the filename.

---

## 4) Muxing Examples

### 4.1 AAC (ADTS) → IMAF with MPEG-7

```bash
npx tsx scripts/mux-imaf.ts \
  --out out/song.ima \
  --in stems/lead.aac \
  --in stems/bv.aac \
  --meta meta/song.json \
  --layout ftyp-mdat-moov
```

### 4.2 MP3 + WAV mix + subtitles (SRT)

```bash
npx tsx scripts/mux-imaf.ts \
  --out out/mix.ima \
  --in stems/drums.mp3 \
  --in stems/bass.wav \
  --subtitle subs/en.srt \
  --meta meta/album-song-track.json
```

### 4.3 With IMAF groups/presets/rules

```bash
npx tsx scripts/mux-imaf.ts \
  --out out/imaf-rich.ima \
  --in stems/lead.aac --in stems/bv.aac \
  --imaf imaf/config.json \
  --meta meta/mpeg7.json
```

---

## 5) Demuxing Examples

### 5.1 Extract all streams + metadata

```bash
npx tsx scripts/demux-imaf.ts \
  --in out/mix.ima \
  --out-dir extracted
```

### 5.2 Convert tx3g → SRT

```bash
npx tsx scripts/3gp-tx3g-to-srt.ts \
  --in subs/en.3gp \
  --out-base subs/en
```

---

## 6) Programmatic API (quick taste)

Full API docs: **[https://blockchainadvisors.github.io/imaf-muxer/api/](https://blockchainadvisors.github.io/imaf-muxer/api/)**

```ts
import {
  composeImaf,
  buildTracksFromInputs,
  type InputFile,
} from "./dist/imaf-mux.min.js";
import { readFileSync, writeFileSync } from "node:fs";

const inputs: InputFile[] = [
  { name: "stems/lead.aac", buf: readFileSync("stems/lead.aac") },
  { name: "stems/bv.aac",   buf: readFileSync("stems/bv.aac") },
];
const subs: InputFile[] = [
  { name: "subs/en.srt", buf: readFileSync("subs/en.srt") },
];

const { tracks, subtitleTracks } = buildTracksFromInputs(inputs, subs);
const out = composeImaf(tracks, {
  subtitleTracks,
  // albumMeta / songMeta / perTrackMeta can be provided here,
  // or passed via CLI --meta with normalizeCliMeta inside scripts.
});

writeFileSync("out/song.ima", out);
```

---

## 7) Verifying Outputs (Optional)

* MP4 structure:

  ```bash
  MP4Box -info out/song.ima | sed -n '1,120p'
  ```
* Audio codecs/streams:

  ```bash
  ffprobe -hide_banner -i out/song.ima
  ```

---

## 8) File Layout Cheat-Sheet

* `src/iso/*` — low-level ISO-BMFF builders (`ftyp`, `moov`, `trak`, `meta`, `grco/prco/ruco`, `xml`).
* `src/codecs/*` — parsers for AAC-ADTS, MP3, WAV/PCM; SRT reader; SAOC (experimental).
* `src/demux/*` — IMAF reader, stream extractors, tx3g demux, SRT converter.
* `src/mux/*` — muxer (`composeImaf`) and helpers.

---

## 9) MPEG-7 / IMAF Notes

* **Album** → file-level `meta` (`hdlr` = `mp7t`) + `xml`.
* **Song** → `moov/udta/meta` + `xml`.
* **Track** → `trak/udta/meta` + `xml`.
* **IMAF** grouping & presets → `grco`, `prco`; rules → `ruco`.

---

## 10) License & Attribution

* Code: see `LICENSE`.
* MPEG-7 & IMAF specs © ISO/IEC.
* MP4/ISO-BMFF structure inspired by GPAC/mp4box.js.

---

## 11) Quick Start TL;DR

```bash
# Install
corepack enable && corepack prepare npm@latest --activate
npm i && npm run build

# Mux
npx tsx scripts/mux-imaf.ts --out out.ima --in a.aac --in b.aac --meta meta/song.json

# Inspect
ffprobe -hide_banner -i out.ima || MP4Box -info out.ima

# Demux
npx tsx scripts/demux-imaf.ts --in out.ima --out-dir extracted/
```

---

**API Reference:** [https://blockchainadvisors.github.io/imaf-muxer/api/](https://blockchainadvisors.github.io/imaf-muxer/api/)