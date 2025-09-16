---
layout: default
title: User Guide
permalink: /guide/
---

# User Guide

# IMAF Muxer/Demuxer – Developer Documentation

_Generated on 2025-09-16_

This project builds and reads IMAF (ISO/IEC 23000-12) media in pure TypeScript/Node. It composes `.ima`/`.mp4` from AAC/MP3/WAV/PCM/tx3g, embeds MPEG-7 album/song/track metadata, and optionally writes/reads IMAF group/preset/rule boxes.

---

## Overview

- **Mux**: compose IMAF/MP4 from inputs (AAC/ADTS, MP3, WAV/PCM, SAOC, SRT/tx3g), attach MPEG-7, and include IMAF boxes.
- **Demux**: extract audio as ADTS/MP3/WAV, extract tx3g (or SRT), collect MPEG-7 XML/JSON, and read IMAF spec JSON.
- **No native deps**: small binary helpers for ISO-BMFF boxes.

---

## Directory layout

```
.
├── docs
│   └── documentation.md
├── src
│   ├── index.ts
│   ├── codecs
│   │   ├── adts.ts
│   │   ├── mp3.ts
│   │   ├── saoc.ts
│   │   ├── srt.ts
│   │   └── wav-pcm.ts
│   ├── demux
│   │   ├── demux-helpers.ts
│   │   ├── imaf-reader.ts
│   │   └── tx3g-demux.ts
│   ├── iso
│   │   ├── audio.ts
│   │   ├── bytes.ts
│   │   ├── imaf.ts
│   │   ├── meta.ts
│   │   ├── mpeg7.ts
│   │   └── subtitle.ts
│   └── mux
│       ├── imaf-writer.ts
│       └── mux-helpers.ts
└── scripts
    ├── 3gp-tx3g-to-srt.ts
    ├── demux-imaf.ts
    └── mux-imaf.ts
```

---

## Public API (barrel)

`src/index.ts` re-exports the library surface:

- **ISO/BMFF core**: `box, str, u16, u32, fixed16_16` (from `iso/bytes`)
- **Audio ISO**: `mvhd, tkhd, mdia_for_track, mp4aSampleEntry`; `type MuxTrack`
- **Meta ISO**: `metaBox, xmlBox, udta`
- **IMAF ISO**: `grcoBox, prcoBox, rucoBox, extractImafSpecFromIso`; `type { Group, Preset, SelectionRule, MixingRule }`
- **MPEG-7**: `mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML`; decode + mappers + defaults:
  `decodeXmlBytes, mpeg7XmlToAlbum/Song/Track, withAlbumDefaults/withSongDefaults/withTrackDefaults`
- **Subtitle ISO (tx3g)**: `buildTx3gTrack, tx3gSampleEntry`; `type { MuxTx3gTrack, SubtitleCue }`
- **Codecs**: `parseAdtsFile (type AacTrack), parseMp3File, parseWavFile, parseSaocElementaryStream, parseSrt`
- **Demuxers**: `extractAllTx3gTracks, cuesToSrt, extractTx3gMuxTracks`
  and from reader: `readIma, buildAdtsStream, buildMp3Stream, buildWavFile, buildTx3g3gpFile, collectMpeg7Metas`
- **Demux helpers**: `demuxImaToArtifacts`; `type { DemuxOptions, DemuxArtifact, DemuxResult }`
- **Muxer**: `composeImaf` (+ `type ComposeOptions`)
- **Mux helpers**: `buildTracksFromInputs, normalizeCliMeta, resolveIncludeImaf`;
  `type { InputFile, MuxBuildOptions, NormalizedMeta }`

---

## Core modules

### ISO bytes (`src/iso/bytes.ts`)
`u8/u16/u24/u32/i16`, `str/cstr`, `pad/concat`, `box`, fixed-point (`fixed16_16/fixed8_8`), `full` (FullBox), `vlen` (var-int).

### Audio track & timing (`src/iso/audio.ts`)
- `type MuxTrack`
- ESDS + sample entry: `esdsBox`, `mp4aSampleEntry`
- Tables: `stsd, stts(frameCount,samplesPerFrame), stsc, stsz, stco`
- Headers/containers: `smhd, dinf_minimal_url_self, hdlr_soun, mdhd, tkhd, mvhd`
- Builders: `stbl_for_track, minf_for_track, mdia_for_track, trak_for_track`

### Timed text (tx3g) (`src/iso/subtitle.ts`)
- `type SubtitleCue`, `type MuxTx3gTrack`
- `tx3gSampleEntry`, `encodeTx3gSample`
- `stts_from_durations`, `stsd_tx3g, stsc, stsz, stco`
- Text media: `nmhd, hdlr_text, mdhd`
- Builders: `stbl_for_tx3g, minf_for_tx3g, mdia_for_tx3g`
- High-level: `buildTx3gTrack(cues, {timescale?, language?, sampleEntry?})`

### IMAF boxes (`src/iso/imaf.ts`)
- `type Group, Preset, SelectionRule, MixingRule, ImafSpec`
- Authors: `grupBox, prstBox, ruscBox, rumxBox`; containers: `grcoBox, prcoBox, rucoBox`
- Reader: `extractImafSpecFromIso(ab) → ImafSpec|undefined` (parses `grco/prco/ruco` from `moov`)

### MPEG-7 (`src/iso/mpeg7.ts`)
- JSON→XML: `mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML`
- Bytes→string: `decodeXmlBytes`
- XML→JSON: `mpeg7XmlToAlbum/Song/Track`
- Defaults/normalisation: `withAlbumDefaults/withSongDefaults/withTrackDefaults`
- Field lists: `ALBUM_FIELDS, SONG_FIELDS, TRACK_FIELDS`

---

## Codecs/parsers (`src/codecs/*`)

- **ADTS AAC** (`adts.ts`)
  - `parseAdtsFile(buf) → AacTrack { sampleRate, channelConfig, asc, frames, sizes, frameCount, totalBytes, mdhdDuration }`

- **MP3** (`mp3.ts`)
  - `parseMp3File(buf)` → `{ codec:'mp3', sampleRate, channelCount, mdhdTimescale, samplesPerFrame, frames, sizes, makeSampleEntry }`

- **WAV/PCM (experimental)** (`wav-pcm.ts`)
  - `parseWavFile(buf, frameSamples=1024)` → `{ codec:'pcm', sampleRate, channelCount, mdhdTimescale, samplesPerFrame, frames, sizes, makeSampleEntry }`

- **SAOC (experimental)** (`saoc.ts`)
  - `parseSaocElementaryStream(raw, {ascPath, samplesPerFrame?})`
    → frames sized by 4-byte BE length prefix; `makeSampleEntry()` uses sidecar ASC.

- **SRT** (`srt.ts`)
  - `parseSrt(text) → SubtitleCue[]`

---

## Demuxers

### ISO reader (`src/demux/imaf-reader.ts`)
- Top-level: `readIma(ab, {debug?}) → { audio: AudioDump[], texts: Tx3gDump[] }`
- MPEG-7: `collectMpeg7Metas(ab) → { album?, song?, tracks[] }`
- Pretty/debug: `dumpBoxTreeConcise(ab) : string`
- Audio emitters: `buildAdtsStream(frames,{sr,ch,aot?,first2?})`, `buildMp3Stream(frames)`, `buildWavFile(pcm,sr,ch,bits)`
- tx3g one-track 3GP: `buildTx3g3gpFile(sampleEntry, frames, durations, timescale)`

### tx3g helpers (`src/demux/tx3g-demux.ts`)
- `extractAllTx3gTracks(ab) → { tracks: Tx3gTrack[], cues: Tx3gCue[][] }`
- **Mux-ready**: `extractTx3gMuxTracks(ab) → MuxTx3gTrack[]` (preserves SampleEntry)
- `cuesToSrt(cues) → string`

### Demux convenience (`src/demux/demux-helpers.ts`)
- `demuxImaToArtifacts(ab, DemuxOptions) → DemuxResult`
  - Emits ready-to-write artifacts:
    - Audio: `.mp3` / `.aac` (ADTS) / `.wav` / `.bin`
    - Text: `.3gp` per tx3g track
    - `meta.json`: album/song/tracks (defaults filled)
    - `imaf.json`: parsed IMAF spec (if present)
  - Types: `DemuxOptions, DemuxArtifact, DemuxResult`

---

## Muxer

### Compose (`src/mux/imaf-writer.ts`)
- `composeImaf(tracks: MuxTrack[], opts?: ComposeOptions): Buffer`
- Options:
  - `layout`: `"ftyp-mdat-moov"` (default) or `"ftyp-moov-mdat"`
  - `movieTimescale`: default `1000`
  - **Subtitles**: `subtitleTracks?: MuxTx3gTrack[]`
  - **IMAF** `includeImaf`:
    - `false` → omit
    - `true` → include simple defaults
    - `string|object` → parse as `ImafSpec` (`groups/presets/rules/globalPresetSteps`)
  - **MPEG-7**:
    - `albumXml`, `songXml`, `perTrackXml[]` _or_
    - `albumMeta`, `songMeta`, `perTrackMeta[]` (auto-XML via `mpeg7*XML`)

### Build helpers (`src/mux/mux-helpers.ts`)
- `buildTracksFromInputs(inputs: InputFile[], subtitles: InputFile[], opts?: MuxBuildOptions)`
  → `{ tracks: MuxTrack[], subtitleTracks: MuxTx3gTrack[] }`
- `normalizeCliMeta(metaJsonText?: string) → NormalizedMeta`
  (maps loose CLI JSON to strong album/song/per-track objects)
- `resolveIncludeImaf(imafJsonText?: string, legacyIncludeImaf?: boolean)`
  → `boolean|string|undefined`
- Types: `InputFile, MuxBuildOptions, ComposeOptions, NormalizedMeta`

---

## Scripts (CLI)

### `scripts/mux-imaf.ts`
Build an `.ima` from audio + (optional) subtitles and meta.

```

tsx scripts/mux-imaf.ts --out out.ima
\--in lead.aac --in drums.mp3 --subtitle subs.srt
\--meta meta.json --imaf imaf.json
\[--layout ftyp-mdat-moov|ftyp-moov-mdat]
\[--pcm-frame N]
\[--saoc-asc path]

```

- `--meta` / `--imaf`: file path or inline JSON
- Accepts inputs: `.aac/.adts`, `.mp3`, `.wav|.pcm`, `.saoc|.loas|.latm`
- Subtitles: `.srt` or `.3gp/.mp4` (tx3g)

### `scripts/demux-imaf.ts`
Extract streams and metadata from an `.ima/.mp4`.

```

tsx scripts/demux-imaf.ts --in input.ima
\[--out-dir dir]
\[--no-audio]
\[--no-text]
\[--no-meta]
\[--no-imaf]
\[--debug "\*|xml|tree"]

```

Emits `.mp3/.aac/.wav`, `.3gp`, `meta.json`, `imaf.json`.

### `scripts/3gp-tx3g-to-srt.ts`
Convert tx3g tracks in `.3gp/.mp4` to `.srt`.

```

tsx scripts/3gp-tx3g-to-srt.ts --in input.3gp \[--out-base base]

````

---

## Conventions & assumptions

- **Timescales**: audio `mdhd` timescale = `sampleRate`; subtitles default to `1000`.
- **Frames per sample**: AAC `1024`, MP3 `1152` (or `576` for some low-sampling cases), PCM configurable.
- **Language**: defaults to `'und'` unless provided.
- **DINF**: minimal self-URL dref is sufficient for self-contained files.
- **SAOC/WAV-PCM**: marked experimental.

---

## Examples

### Minimal mux (AAC + SRT → IMAF)
```ts
import { parseAdtsFile, parseSrt, buildTx3gTrack, composeImaf } from "imaf-mux";

const aac = await fs.promises.readFile("lead.aac");
const tr = parseAdtsFile(aac);

const srt = await fs.promises.readFile("subtitles.eng.srt","utf8");
const cues = parseSrt(srt);
const tx = buildTx3gTrack(cues, { timescale: 1000, language: "eng" });

const out = composeImaf(
  [{
    sampleRate: tr.sampleRate,
    mdhdDuration: tr.mdhdDuration,
    frames: tr.frames, sizes: tr.sizes, frameCount: tr.frameCount,
    samplesPerFrame: 1024,
    makeSampleEntry: () => mp4aSampleEntry(tr.sampleRate, tr.channelConfig, tr.asc),
  }],
  { subtitleTracks: [tx], includeImaf: true }
);

await fs.promises.writeFile("out.ima", out);
````

### Demux to artifacts

```ts
import { demuxImaToArtifacts } from "imaf-mux";
const buf = await fs.promises.readFile("in.ima");
const res = demuxImaToArtifacts(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
  basename: "in",
  debug: ["xml"]
});
for (const f of [...res.audio, ...res.text]) {
  await fs.promises.writeFile(`out/${f.name}`, f.data);
}
if (res.metaJson) await fs.promises.writeFile(`out/${res.metaJson.name}`, res.metaJson.text);
if (res.imafJson) await fs.promises.writeFile(`out/${res.imafJson.name}`, res.imafJson.text);
```

---

## MPEG-7 mapping (as used)

* **Album (file-level meta)**: `title, artist, genre, releaseDate, production, publisher, copyright, coverUrl, siteUrl`
* **Song (moov/udta/meta)**: `title, singer, composer, lyricist, genre, releaseDate, production, publisher, copyright, isrc, cdTrackNo, imageUrl, siteUrl`
* **Track (trak/udta/meta)**: `title, performer, recordedAt`

---
