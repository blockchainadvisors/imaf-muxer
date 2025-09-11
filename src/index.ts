// --- ISO-BMFF core & helpers ---
export { box, str, u16, u32, fixed16_16 } from "./iso/bytes";
export { mvhd, tkhd, mdia_for_track, mp4aSampleEntry } from "./iso/audio";
export { metaBox, xmlBox, udta } from "./iso/meta";
export { grcoBox, prcoBox, rucoBox } from "./iso/imaf";
export type { Group, Preset, SelectionRule, MixingRule } from "./iso/imaf";
export type { MuxTrack } from "./iso/audio";
export { mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML } from "./iso/mpeg7";
export type { MuxTx3gTrack, SubtitleCue } from "./iso/subtitle";
export { buildTx3gTrack, tx3gSampleEntry } from "./iso/subtitle";

// --- Codecs / parsers ---
export { parseAdtsFile } from "./codecs/adts";
export type { AacTrack } from "./codecs/adts";
export { parseMp3File } from "./codecs/mp3";
export { parseWavFile } from "./codecs/wav-pcm";
export { parseSaocElementaryStream } from "./codecs/saoc";
export { parseSrt } from "./codecs/srt";

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
} from "./demux/ima-reader";

// --- MPEG-7 utils ---
export { decodeXmlBytes, mpeg7XmlToAlbum, mpeg7XmlToSong, mpeg7XmlToTrack, withAlbumDefaults, withSongDefaults, withTrackDefaults } from "./iso/mpeg7";

// Composer
export { composeImaf } from "./composer/imaf-composer";