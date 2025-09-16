/* @file src/index.ts
 * @description
 * Entry point for the IMAF muxer/demuxer library.
 * 
 * This file re-exports all the core public APIs from the internal modules:
 * - **Muxing**: Compose IMAF containers from inputs (audio, text, metadata, IMAF JSON).
 * - **Demuxing**: Read and extract artifacts (audio tracks, subtitles, MPEG-7 metadata, IMAF specs) from IMAF containers.
 * - **Codecs**: Helpers for handling AAC/ADTS, MP3, PCM/WAV, SAOC, SRT/tx3g subtitles.
 * - **ISO-BMFF helpers**: Core box parsing/writing, MPEG-7 parsing, subtitle helpers.
 * - **Imaf-specific**: Box structure parsing (grco, prco, ruco) and JSON schema helpers.
 * 
 * This ensures that consumers of the library can simply import from the built bundle
 * (e.g. `import { composeImaf, readIma } from "imaf-muxer"`) without reaching into subdirectories.
 */

// --- ISO-BMFF core & helpers ---
export { box, str, u16, u32, fixed16_16 } from "./iso/bytes";
export { mvhd, tkhd, mdia_for_track, mp4aSampleEntry } from "./iso/audio";
export { metaBox, xmlBox, udta } from "./iso/meta";
export { grcoBox, prcoBox, rucoBox, extractImafSpecFromIso } from "./iso/imaf";
export type { Group, Preset, SelectionRule, MixingRule } from "./iso/imaf";
export type { MuxTrack } from "./iso/audio";
export { mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML } from "./iso/mpeg7";
export type { MuxTx3gTrack, SubtitleCue } from "./iso/subtitle";
export { buildTx3gTrack, tx3gSampleEntry } from "./iso/subtitle";

// --- Codecs / parsers ---
export { parseAdtsFile } from "./codecs/adts";
export { parseMp3File } from "./codecs/mp3";
export { parseWavFile } from "./codecs/wav-pcm";
export { parseSaocElementaryStream } from "./codecs/saoc";
export { parseSrt } from "./codecs/srt";
export type { AacTrack } from "./codecs/adts";
export type { SaocOptions } from "./codecs/saoc";

// --- Demuxers / extractors ---
export { extractAllTx3gTracks, cuesToSrt, extractTx3gMuxTracks } from "./demux/tx3g-demux";
export type { Tx3gCue } from "./demux/tx3g-demux";
export {
    readIma,
    buildAdtsStream,
    buildMp3Stream,
    buildWavFile,
    buildTx3g3gpFile,
    collectMpeg7Metas,
} from "./demux/imaf-reader";

// --- Demux helpers ---
export { demuxImaToArtifacts } from "./demux/demux-helpers";
export type { DemuxOptions, DemuxArtifact } from "./demux/demux-helpers";
export type { DemuxResult } from "./demux/demux-helpers";

// --- MPEG-7 utils ---
export { decodeXmlBytes, mpeg7XmlToAlbum, mpeg7XmlToSong, mpeg7XmlToTrack, withAlbumDefaults, withSongDefaults, withTrackDefaults } from "./iso/mpeg7";

// Muxer
export { composeImaf } from "./mux/imaf-writer";
export type { MpegBox } from "./demux/imaf-reader";

// Mux helpers
export { buildTracksFromInputs, normalizeCliMeta, resolveIncludeImaf } from "./mux/mux-helpers";
export type { InputFile, MuxBuildOptions, NormalizedMeta } from "./mux/mux-helpers";
export type { ComposeOptions } from "./mux/imaf-writer";

// --- Metadata types ---
export type { AlbumMeta, SongMeta, TrackMeta } from "./iso/mpeg7";
export type { ImafSpec } from "./iso/imaf";
export type { NormalizedAlbumMeta, NormalizedSongMeta, NormalizedTrackMeta } from "./mux/mux-helpers";
export type { Mpeg7MetaSummary, AudioDump, Tx3gDump } from "./demux/imaf-reader";
export type { Tx3gTrack } from "./demux/tx3g-demux";