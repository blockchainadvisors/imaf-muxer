# IMAF Muxer/Demuxer – Developer Documentation

_Generated on 2025-09-11 17:13 UTC_

This document describes the structure and public API of your IMAF (ISO/IEC 23000‑12) muxer/demuxer. It summarises each file and exported function to speed up future integrations and assisted development.

## Overview
The codebase builds and reads IMAF-compliant MP4/ISO‑BMFF files in pure TypeScript/Node. Key capabilities:
- **Mux**: Compose an .ima file from AAC (ADTS), MP3, WAV/PCM (experimental), and tx3g subtitles; embed **MPEG‑7** album/song/track metadata; add IMAF **group/preset/rule** boxes.
- **Demux**: Parse an .ima/.mp4 to recover raw audio streams, wrap them back into ADTS/MP3/WAV/3GP, and extract MPEG‑7 XML/JSON and tx3g/SRT cues.
- **No external native deps**: Uses small binary helpers for ISO‑BMFF assembly.

## Directory layout
```
src/index.ts
src/codecs/adts.ts
src/codecs/mp3.ts
src/codecs/saoc.ts
src/codecs/srt.ts
src/codecs/wav-pcm.ts
src/composer/imaf-composer.ts
src/demux/ima-reader.ts
src/demux/tx3g-demux.ts
src/iso/audio.ts
src/iso/bytes.ts
src/iso/imaf.ts
src/iso/meta.ts
src/iso/mpeg7.ts
src/iso/subtitle.ts
scripts/3gp-tx3g-to-srt.ts
scripts/audio-tracks-to-imaf.ts
scripts/imaf-extract.ts
```

## Core binary helpers (`src/iso/bytes.ts`)
- `u8/u16/u24/u32/i16` — UInt/Int big‑endian writers
- `str/cstr` — ASCII / C‑string encoders
- `pad/concat` — Padding and Buffer concatenation
- `box(type, ...payloads)` — ISO‑BMFF box builder with size+type header
- `fixed16_16/fixed8_8` — Fixed‑point helpers
- `full(version, flags)` — FullBox header
- `vlen(n)` — ISO/MP4 variable‑length integer encoding

## Audio track & timing (`src/iso/audio.ts`)
- `MuxTrack` — Generic audio track shape for muxing (codec‑agnostic).
- `esdsBox(oti, asc)` — Build ESDS with DecoderConfig and DecSpecificInfo.
- `mp4aSampleEntry(track|asc,...)` — aac 'mp4a' sample entry from ASC or via `track.makeSampleEntry()`.
- `mdhd(sampleRate, duration)` — Media Header box with language 'und'.
- `tkhd(trackId, duration)` — Track Header box.
- `mvhd(timescale, duration)` — Movie Header box.
- `stsd/stts/stsc/stsz/stco` — Table boxes for sample descriptions, timing, chunking, sizes, offsets.
- `smhd/dinf_minimal_url_self/hdlr_soun` — Sound handler and sound media header.
- `stbl_for_track/minf_for_track/mdia_for_track/trak_for_track` — Assemble track structures for an audio stream.

## Timed text (tx3g) (`src/iso/subtitle.ts`)
- `SubtitleCue` — Plain cue type {startMs,endMs,text,lang?}.
- `MuxTx3gTrack` — Muxable tx3g track shape.
- `tx3gSampleEntry()` — Build tx3g sample entry.
- `encodeTx3gSample(cue)` — Encode a cue to a tx3g sample.
- `stts_from_durations(durations)` — Utility to build STTS from per‑sample durations.
- `mdhd / stbl_for_tx3g / minf_for_tx3g / mdia_for_tx3g` — Timed‑text media structures.
- `buildTx3gTrack(cues, timescale, lang)` — Create a muxable tx3g track.

## Meta boxes (`src/iso/meta.ts`)
- `hdlr_generic(handler, name)` — Generic handler box used inside meta.
- `xmlBox(xml)` — Raw XML payload box ('xml ').
- `metaBox(handler, name, ...children)` — Meta FullBox + handler + children (e.g., xml).
- `udta(...children)` — User data box wrapper.

## IMAF boxes (`src/iso/imaf.ts`)
- `Group` — IMAF 'group' concept (id, elementIDs, activation, ref volume, name/description).
- `grupBox(group)` — Encode a single Group.
- `Preset` — IMAF preset (presetID, elementIDs, volumes, name, flags).
- `prstBox(presets, defaultPresetId?)` — Preset collection + default.
- `SelectionRule` — RUSC selection rule variants.
- `MixingRule` — RUMX mixing rule variants (incl. min/max volume or key‑element rules).
- `ruscBox(rule)` — Encode a selection rule.
- `rumxBox(rule)` — Encode a mixing rule.
- `rucoBox(selection[], mixing[])` — Top‑level rule container.
- `grcoBox(groups[])` — Top‑level group container.
- `prcoBox(presets[], defaultId)` — Top‑level preset container.

## MPEG‑7 helpers (`src/iso/mpeg7.ts`)
- `mpeg7AlbumXML(meta)` — Serialise AlbumMeta → MPEG‑7 XML.
- `mpeg7SongXML(meta)` — Serialise SongMeta → MPEG‑7 XML.
- `mpeg7TrackXML(meta)` — Serialise TrackMeta → MPEG‑7 XML.
- `decodeXmlBytes(bytes)` — Decode Uint8Array/Buffer → UTF‑8 string.
- `mpeg7XmlToAlbum/Song/Track(xml)` — Parse MPEG‑7 XML into partial JSON.
- `withAlbumDefaults/SongDefaults/TrackDefaults(metaPartial)` — Fill schema‑complete JSON placeholders.

## Codecs/parsers (`src/codecs/*`)
- `parseAdtsFile(buf) → AacTrack` — Scan ADTS headers, derive ASC, collect AAC payload frames.
- `parseMp3File(buf)` — Scan MP3 headers, collect frames, infer sample rate/channels/samplesPerFrame.
- `parseWavFile(buf, frameSamples?)` — Parse RIFF WAV PCM, packetise into frames (experimental).
- `parseSaocElementaryStream(buf, {ascPath,...})` — Split raw SAOC stream and build sample entry from sidecar ASC (experimental).
- `parseSrt(text) → SubtitleCue[]` — Parse SRT to cues.

## Demuxer (`src/demux/ima-reader.ts`)
- `readIma(arrayBuffer)` — Walk ftyp/moov/mdat, return tracks {audio[], texts[], albumXml, songXml, trackXml[]} and table data.
- `dumpBoxTreeConcise(ab)` — Return a concise textual tree of boxes for debugging.
- `collectMpeg7Metas(read) → {album,song,tracks}` — Turn embedded XML into JSON with defaults applied.
- `buildAdtsStream(track)` — Re‑wrap raw AAC frames with ADTS headers.
- `buildMp3Stream(track)` — Concatenate MP3 frames to .mp3 file.
- `buildWavFile(track)` — Build a simple WAV/PCM file from LPCM samples.
- `buildTx3g3gpFile(track,cues?)` — Wrap tx3g samples into a minimal 3GP for playback.
- **Debugging**: Set `IMA_DEBUG=*` or `IMA_DEBUG=read,tx3g` to print internal traces.

## tx3g demux helpers (`src/demux/tx3g-demux.ts`)
- `extractAllTx3gTracks(ab) → {tracks,cues}` — Find all tx3g tracks and decode them to cues.
- `extractTx3gMuxTracks(ab) → MuxTx3gTrack[]` — Return mux‑shaped tx3g tracks (sizes/offsets/durations).
- `cuesToSrt(cues) → string` — Serialise cues into SRT text.
- `decodeTx3gSample(u8) → SubtitleCue` — Decode a single tx3g sample.
- `readStts/Stsz/Stsc/ChunkOffsets` — Low‑level ISO table readers used for timed text.

## Composer (`src/composer/imaf-composer.ts`)
- `composeImaf(opts)` — Compose a full IMAF file from audio tracks (and optional tx3g subtitles) and MPEG‑7/IMAF metadata.
  - Options: `layout` (`'ftyp-mdat-moov'|'ftyp-moov-mdat'`), `movieTimescale`, album/song/track XML strings or JSON to auto‑generate XML, and IMAF groups/presets/rules.

## CLI scripts (`scripts/*`)
- `audio-tracks-to-imaf.ts out.imaf [--meta meta.json|--meta='{"album":...}'] <inputs...>` — Build an .imaf file. Accepts mixed inputs: `.aac` (ADTS), `.mp3`, `.wav` (PCM), `.saoc` (with `--asc`), and `.srt`/`.3gp` timed text. Uses `composeImaf` under the hood.
- `imaf-extract.ts input.imaf [outDir]` — Extract streams to files and emit `meta.json` with schema‑complete Album/Song/Track metadata.
- `3gp-tx3g-to-srt.ts input.3gp [outBase]` — Convert tx3g text tracks in a .3gp/.mp4 to SRT files.

## MPEG‑7 metadata mapping (as used here)
- **File‑level `meta` (album)**: title, artist, genre, releaseDate, production, publisher, copyright, coverUrl, siteUrl.
- **Movie‑level `moov/meta` (song)**: title, singer, composer, lyricist, genre, releaseDate, ISRC, cdTrackNumber, production, publisher, copyright, image, siteUrl.
- **Track‑level `trak/meta` (track)**: title, performerName, recordingDateTime.

## Examples
### Programmatic mux example
```ts
// ESM
import { composeImaf, parseAdtsFile, mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML } from 'imaf-mux';
const aac = await fs.promises.readFile('lead.aac');
const tr = parseAdtsFile(aac);
const buf = composeImaf({
  albumXml: mpeg7AlbumXML({ title: 'Album', artist: 'Various' }),
  songXml:  mpeg7SongXML({ title: 'Song', singer: 'Unknown' }),
  trackXml: [mpeg7TrackXML({ title: 'Lead' })],
}, [tr]);
await fs.promises.writeFile('out.imaf', buf);
```
### Demux example
```ts
import { readIma, collectMpeg7Metas, buildAdtsStream } from 'imaf-mux';
const data = await fs.promises.readFile('in.imaf');
const parsed = readIma(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
const xmls = collectMpeg7Metas(parsed);
await fs.promises.writeFile('audio0.aac', buildAdtsStream(parsed.audio[0]));
```

## Build & publish
- `npm run build` → emits `dist/imaf-mux.min.js` and `dist/imaf-mux.min.d.ts` and prunes extras via `pack:dist`.
- Runtime import path is the package root export: `import {...} from 'imaf-mux'`.

## Conventions & assumptions
- Timescales: audio uses mdhd timescale = sampleRate; movie timescale is configurable.
- AAC assumes 1024 samples/frame; MP3 1152 unless header indicates 576.
- Language defaults to `'und'` in mdhd unless provided.
- Minimal `dinf` URL data reference suffices for self‑contained files.

## Debugging flags
- Set `IMA_DEBUG=*` to log all; or comma‑separate namespaces (e.g., `read,tx3g`).

## Glossary
- **ASC**: AudioSpecificConfig (MPEG‑4/H.264 AAC configuration bytes).
- **ESDS**: Elementary Stream Descriptor box.
- **STTS/STSC/STSZ/STCO**: Timing, chunking, size, and chunk offset tables.
- **tx3g**: 3GPP Timed Text.
- **IMAF**: Interactive Music Application Format.

## Per‑file quick index
- `src/index.ts` — (entry/CLI or config)
- `src/codecs/adts.ts`
  - function `parseAdtsFile`
  - type `AacTrack`
- `src/codecs/mp3.ts`
  - function `parseMp3File`
- `src/codecs/saoc.ts`
  - function `parseSaocElementaryStream`
- `src/codecs/srt.ts`
  - function `parseSrt`
- `src/codecs/wav-pcm.ts`
  - function `parseWavFile`
- `src/composer/imaf-composer.ts`
  - function `composeImaf`
  - type `ComposeOptions`
- `src/demux/ima-reader.ts`
  - function `collectMpeg7Metas`
  - function `decodeXmlBytes`
  - function `dumpBoxTreeConcise`
  - function `readIma`
  - function `buildAdtsStream`
  - function `buildMp3Stream`
  - function `buildWavFile`
  - function `buildTx3g3gpFile`
  - type `Mpeg7MetaSummary`
  - type `AudioDump`
  - type `Tx3gDump`
- `src/demux/tx3g-demux.ts`
  - function `extractTx3gMuxTracks`
  - function `extractAllTx3gTracks`
  - function `cuesToSrt`
  - type `Tx3gCue`
  - type `Tx3gTrack`
- `src/iso/audio.ts`
  - function `esdsBox`
  - function `mp4aSampleEntry`
  - function `mdhd`
  - function `tkhd`
  - function `mvhd`
  - function `stbl_for_track`
  - function `minf_for_track`
  - function `mdia_for_track`
  - function `trak_for_track`
  - const `stsd`
  - const `stts`
  - const `stsc`
  - const `stsz`
  - const `stco`
  - const `smhd`
  - const `dinf_minimal_url_self`
  - const `hdlr_soun`
  - type `MuxTrack`
- `src/iso/bytes.ts`
  - const `u8`
  - const `u16`
  - const `i16`
  - const `u24`
  - const `u32`
  - const `str`
  - const `cstr`
  - const `pad`
  - const `concat`
  - const `box`
  - const `fixed16_16`
  - const `fixed8_8`
  - const `full`
  - const `vlen`
- `src/iso/imaf.ts`
  - function `grupBox`
  - function `prstBox`
  - function `ruscBox`
  - function `rumxBox`
  - const `grcoBox`
  - const `prcoBox`
  - const `rucoBox`
  - type `Group`
  - type `Preset`
  - type `SelectionRule`
  - type `MixingRule`
- `src/iso/meta.ts`
  - function `hdlr_generic`
  - function `metaBox`
  - const `xmlBox`
  - const `udta`
- `src/iso/mpeg7.ts`
  - function `mpeg7AlbumXML`
  - function `mpeg7SongXML`
  - function `mpeg7TrackXML`
  - function `decodeXmlBytes`
  - function `albumDefaults`
  - function `songDefaults`
  - function `trackDefaults`
  - function `withAlbumDefaults`
  - function `withSongDefaults`
  - function `withTrackDefaults`
  - function `mpeg7XmlToAlbum`
  - function `mpeg7XmlToSong`
  - function `mpeg7XmlToTrack`
- `src/iso/subtitle.ts`
  - function `tx3gSampleEntry`
  - function `encodeTx3gSample`
  - function `stts_from_durations`
  - function `mdhd`
  - function `stbl_for_tx3g`
  - function `minf_for_tx3g`
  - function `mdia_for_tx3g`
  - function `buildTx3gTrack`
  - const `stsd_tx3g`
  - const `stsc`
  - const `stsz`
  - const `stco`
  - const `nmhd`
  - const `hdlr_text`
  - type `SubtitleCue`
  - type `MuxTx3gTrack`
- `scripts/3gp-tx3g-to-srt.ts` — (entry/CLI or config)
- `scripts/audio-tracks-to-imaf.ts` — (entry/CLI or config)
- `scripts/imaf-extract.ts` — (entry/CLI or config)

## Selected low‑level function notes (demux)
- `payloadStartForChildren` — Compute the byte offset where children of a container box begin (header size + extended size).
- `kids` — List immediate child boxes of a given container (returns Box[] with start/size/type).
- `child` — Find the first child box with a given type.
- `findBoxDeep` — Depth‑first search for all boxes with a given type.
- `readStts` — Read Decoding Time to Sample (STTS) table into an array of durations.
- `readStsc` — Read Sample To Chunk (STSC) mapping entries.
- `readStsz` — Read Sample Size (STSZ) table — returns per‑sample sizes (handles default size optimisation).
- `readChunkOffsets` — Read STCO/CO64 chunk offsets.
- `buildSampleOffsets` — Expand chunk maps into absolute MDAT sample offsets.
- `mdhdInfo` — Extract mdhd timescale, duration and language.
- `handlerType` — Read HDLR handler type (e.g., 'soun', 'text', 'subt').
- `readStsdEntry` — Read first sample entry to infer codec (mp4a, lpcm, etc.).
- `parseEsdsAsc` — Extract AAC AudioSpecificConfig from ESDS.
- `xmlBytesFromMeta` — Locate meta → 'xml ' leaf and return raw bytes.
- `readMetaHandler` — Read meta box handler (mp7t for MPEG‑7).
- `metaLabel` — Pretty label for meta location (file/movie/track).
- `collectMpeg7Metas` — Collect album/song/track MPEG‑7 XML bytes and decode to strings.
- `decodeXmlBytes` — UTF‑8 decode utility (also exported by mpeg7.ts).
- `prettyXml` — Indent a compact XML string for display.
- `dumpBoxTreeConcise` — Return a concise single‑line tree of the ISO‑BMFF structure.
- `readIma` — Top‑level demux: returns {audio, texts, albumXml, songXml, trackXml[]}.
- `adtsHeader` — Build a 7/9‑byte ADTS header from SR/channels/profile.
- `buildAdtsStream` — Emit ADTS file from raw AAC frames.
- `buildMp3Stream` — Concatenate MP3 frames into a valid .mp3.
- `buildWavFile` — Wrap LPCM frames into a minimal RIFF/WAV file.
- `u32/u16/str4/box` — Local helpers for building minimal 3GP for tx3g.
- `buildTx3g3gpFile` — Emit a minimal .3gp with a single tx3g track.
