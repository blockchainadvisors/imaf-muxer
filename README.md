# IMAF Muxer / Demuxer — Installation & Usage

This project provides a **pure TypeScript** IMAF (ISO/IEC 23000‑12) muxer/demuxer with MPEG‑7 metadata support and minimal ISO‑BMFF builders. It can:
- **Mux** multiple audio sources (AAC/ADTS, MP3, WAV/PCM; SAOC experimental) and optional **tx3g** subtitles into a single `.imaf` (MP4) file, embedding **MPEG‑7 XML** (album / song / track).
- **Demux** `.imaf`/`.mp4` back to original streams, extract **MPEG‑7** as JSON with schema‑complete defaults, and convert **tx3g** ⇄ **SRT**.

> Works fully in Node.js (no native deps). Optional tools (MP4Box, FFmpeg) help with validation and auxiliary conversions.

---

## 1) Prerequisites

### Required
- **Node.js 20.x** or newer  
  - Recommended via **nvm**:
    ```bash
    # macOS / Linux
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    source ~/.nvm/nvm.sh
    nvm install 20
    nvm use 20
    node -v  # should be v20.x
    ```
- **npm**
  ```bash
  corepack enable            # Node 20 ships Corepack
  corepack prepare npm@latest --activate
  npm -v
  ```

### Optional (nice to have for validation/interop)
- **FFmpeg** (probe/convert): https://ffmpeg.org/
  ```bash
  # Ubuntu/Debian
  sudo apt-get update && sudo apt-get install -y ffmpeg
  ffmpeg -version
  ```
- **MP4Box** from GPAC (inspect files, tx3g helpers): https://gpac.io/
  ```bash
  # Ubuntu (PPA)
  sudo add-apt-repository ppa:gpac/gpac
  sudo apt-get update && sudo apt-get install -y gpac
  MP4Box -version
  ```

---

## 2) Clone & Install

```bash
git clone https://github.com/blockchainadvisors/imaf-muxer.git
cd imaf-muxer

# Install dependencies
npm install

# Build (ESM + types)
npm build

# (Optional) Run unit tests
npm test            # if tests are present (no tests present atm)
```

> If you want to run TypeScript directly without prebuilding, this repo uses **tsx** under the hood:
> ```bash
> npm tsx scripts/your-script.ts
> ```

---

## 3) Project Scripts Overview

Common entry points (CLI‑style) included with the project:

- `scripts/audio-tracks-to-imaf.ts` — **Mux** multiple audio tracks (+ optional subtitles + MPEG‑7) into `.imaf`.
- `scripts/imaf-extract.ts` — **Demux** streams from `.imaf` & export schema‑complete `meta.json`.
- `scripts/3gp-tx3g-to-srt.ts` — Convert **3GP/tx3g** → **.srt**.

You can run them via `npm` (if wired in `package.json`), or directly with `tsx`:

```bash
npm tsx scripts/audio-tracks-to-imaf.ts
npm tsx scripts/imaf-extract.ts
npm tsx scripts/3gp-tx3g-to-srt.ts
```

---

## 4) Muxing Examples

### 4.1 AAC (ADTS) → IMAF with MPEG‑7

```bash
npm tsx src/audio-tracks-to-imaf.ts \
  --out out/song.ima \
  --in track1.aac --title "Lead Vocal" \
  --in track2.aac --title "Backing Vocal" \
  --in track3.aac --title "Guitar" \
  --meta meta/mpeg7.json \
  --layout ftyp-mdat-moov
```

- `--meta` can be JSON (project’s schema) or XML (MPEG‑7).
- Layouts: `ftyp-mdat-moov` (default; faster), `ftyp-moov-mdat` (classic).

### 4.2 MP3 / WAV mix

```bash
npm tsx src/audio-tracks-to-imaf.ts \
  --out out/mix.ima \
  --in stems/drums.mp3 --title "Drums" \
  --in stems/bass.wav  --title "Bass" \
  --meta meta/album-song-track.json
```

### 4.3 Add tx3g subtitles (3GP) or SRT

You can input:
- `.3gp` with `tx3g` tracks, or
- `.srt` (auto‑converted to tx3g track internally).

```bash
# With an existing 3GP file containing tx3g
npm tsx src/audio-tracks-to-imaf.ts \
  --out out/with-subs.imaf \
  --in audio/lead.aac \
  --subtitle subs/en.3gp --title "English CC"
```

### 4.4 IMAF groups / presets / rules (advanced)

Provide an **IMAF config JSON** with `groups`, `presets`, `selectionRules`, and (optionally) `mixingRules`:

```bash
npm tsx src/audio-tracks-to-imaf.ts \
  --out out/imaf-rich.ima \
  --in stems/lead.aac --title "Lead" --group Vocals \
  --in stems/bv.aac   --title "Backing" --group Vocals \
  --imaf imaf/config.json \ (not yet implemented)
  --meta meta/mpeg7.json
```
working example:
```bash
npx tsx scripts/audio-tracks-to-imaf.ts --out demo.ima --subtitle demo-content/Zlyrics.3gp --meta demo-content/song1.json --in demo-content/Guitar.mp3 --in demo-content/Keys.mp3 demo-content/Acustic.mp3 --in demo-content/Bass.mp3 --in demo-content/Drums.mp3
```

> Internally this writes `grco`, `prco`, `ruco` boxes alongside the `meta`/`hdlr(mp7t)`/`xml ` trio.

---

## 5) Demuxing Examples

### 5.1 Extract all streams + full metadata JSON

```bash
npm tsx src/imaf-extract.ts \
  --in out/mix.ima \
  --out-dir extracted/
```

Outputs may include:
- `track_1.aac`, `track_2.mp3`, `track_3.wav`
- `subtitle_1.tx3g.3gp` (if present)
- `meta.json` — MPEG‑7 expanded JSON (album/song/track) with schema‑complete defaults

### 5.2 Convert tx3g → SRT

```bash
npm tsx src/3gp-tx3g-to-srt.ts \
  subs/en.3gp \
  --out subs/en.srt
```

---

## 6) Programmatic API (quick taste)

```ts
import { composeImaf } from "./scripts/composer/imaf-composer";
import { parseAdtsFile } from "./scripts/codecs/aac-adts";
import { readFileSync, writeFileSync } from "node:fs";

const adts1 = parseAdtsFile("stems/lead.aac");
const adts2 = parseAdtsFile("stems/bv.aac");

const { bytes, report } = await composeImaf({
  tracks: [
    { kind: "audio", codec: "aac", name: "Lead",  source: adts1 },
    { kind: "audio", codec: "aac", name: "BVs",   source: adts2 },
  ],
  mpeg7: { /* album/song/track JSON or XML string */ },
  imaf:  { /* groups/presets/rules */ },
  layout: "ftyp-mdat-moov",
});

writeFileSync("out/song.imaf", bytes);
console.log(report);
```

---

## 7) Environment Variables & Debugging

- `IMA_DEBUG=*` — enable all internal traces.
- `IMA_DEBUG=read,tx3g,mpeg7` — select granular areas.
- `NODE_OPTIONS=--max-old-space-size=4096` — if working with very large inputs.

Example:
```bash
IMA_DEBUG=read,tx3g npm dlx tsx src/imaf-extract.ts --in out/mix.imaf --out-dir extracted/
```

---

## 8) Docker (Optional)

If you prefer a containerised workflow:

```yaml
# docker-compose.yml
services:
  imaf:
    image: node:20
    working_dir: /work
    volumes:
      - ./:/work
    command: sh -lc "corepack enable && corepack prepare npm@latest --activate && npm i && npm build && bash"
```
Run:
```bash
docker compose up --build
# then inside container shell:
npm dlx tsx src/audio-tracks-to-imaf.ts --help
```

---

## 9) Verifying Outputs (Optional)

- MP4 structure:
  ```bash
  MP4Box -info out/song.imaf | sed -n '1,120p'
  ```
- Audio stream codecs:
  ```bash
  ffprobe -hide_banner -i out/song.imaf
  ```

---

## 10) Troubleshooting

- **Timeouts / large files**: raise memory: `NODE_OPTIONS=--max-old-space-size=4096`.
- **Invalid ADTS**: ensure each `.aac` is proper ADTS (LC profile). Re‑mux if needed:
  ```bash
  ffmpeg -i input.wav -c:a aac -profile:a aac_low -b:a 192k -f adts fixed.aac
  ```
- **Bad 3GP/tx3g**: rebuild with GPAC:
  ```bash
  MP4Box -add input.srt:lang=en:hdlr=sbtl -new subs/en.3gp
  ```
- **Wrong timescale / drift**: prefer consistent sample rates (e.g., 48kHz).

---

## 11) File Layout Cheat‑Sheet

- `src/iso/*` — low‑level ISO‑BMFF box builders (`ftyp`, `moov`, `trak`, `meta`, `grco/prco/ruco`, `xml`).
- `src/codecs/*` — parsers for AAC‑ADTS, MP3, WAV; SRT reader.
- `src/demux/*` — `.imaf` reader, stream extractors, tx3g demux, SRT converter.
- `src/composer/imaf-composer.ts` — high‑level muxer (`composeImaf`).

---

## 12) MPEG‑7 / IMAF Notes

- **Album** → file‑level `meta` (`hdlr`=`mp7t`) + `xml` (MPEG‑7).
- **Song** → movie‑level `moov/meta` + `xml`.
- **Track** → track‑level `trak/meta` + `xml`.
- **IMAF** grouping & presets → `grco`, `prco`, **rules** → `ruco`.

This mapping keeps your files aligned with ISO/IEC 23000‑12 responsibilities.

---

## 13) License & Attribution

- This repository’s code: see `LICENSE`.
- MPEG‑7 & IMAF specs © ISO/IEC — used for interoperability.
- MP4/ISO‑BMFF structure inspired by GPAC/mp4box.js.

---

## 14) Quick Start TL;DR

```bash
# 1) Install
corepack enable && corepack prepare npm@latest --activate
npm i && npm build

# 2) Mux
npm tsx src/audio-tracks-to-imaf.ts --out out.imaf --in a.aac --in b.aac --meta meta/mpeg7.json

# 3) Inspect
ffprobe -hide_banner -i out.imaf || MP4Box -info out.imaf

# 4) Demux
npm tsx src/imaf-extract.ts --in out.imaf --out-dir extracted/
```
