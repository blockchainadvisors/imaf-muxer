// src/mux/imaf-writer.ts
import { box, str, u32, concat } from "../iso/bytes";
import { mvhd, tkhd, mdia_for_track, type MuxTrack } from "../iso/audio";
import { metaBox, xmlBox, udta } from "../iso/meta";
import {
  grcoBox, prcoBox, rucoBox,
  type Group, type Preset, type SelectionRule, type MixingRule, type ImafSpec
} from "../iso/imaf";
import { AlbumMeta, SongMeta, TrackMeta, mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML } from "../iso/mpeg7";
import type { MuxTx3gTrack } from "../iso/subtitle";
import { mdia_for_tx3g } from "../iso/subtitle";

/** Composer options for layout, metadata, IMAF, and subtitle tracks. */
export type ComposeOptions = {
  layout?: "ftyp-mdat-moov" | "ftyp-moov-mdat";
  movieTimescale?: number;

  /** Optional MPEG-7 XML overrides. */
  albumXml?: string;
  songXml?: string;
  perTrackXml?: string[];

  /**
   * IMAF boxes:
   *  - false  → omit
   *  - true   → include defaults
   *  - string → JSON string (ImafSpec)
   *  - object → ImafSpec
   */
  includeImaf?: boolean | string | ImafSpec;

  /** Optional tx3g subtitle tracks. */
  subtitleTracks?: MuxTx3gTrack[];

  /** Structured metadata used if XML not provided. */
  albumMeta?: AlbumMeta;
  songMeta?: SongMeta;
  perTrackMeta?: TrackMeta[];
};

/** Parse includeImaf value into ImafSpec (string/object) or undefined. */
function parseImafSpec(val: unknown): ImafSpec | undefined {
  if (!val) return undefined;
  if (typeof val === "string") { try { return JSON.parse(val) as ImafSpec; } catch { return undefined; } }
  if (typeof val === "object") return val as ImafSpec;
  return undefined;
}

/**
 * Compose an ISOBMFF file with audio tracks, optional tx3g subtitles, MPEG-7 meta, and IMAF boxes.
 * @param tracks Audio tracks.
 * @param opts ComposeOptions.
 * @returns Complete MP4/ISOBMFF bytes.
 */
export function composeImaf(tracks: MuxTrack[], opts: ComposeOptions = {}): Uint8Array {
  const {
    layout = "ftyp-mdat-moov",
    movieTimescale = 1000,
    includeImaf = true,
    subtitleTracks = []
  } = opts;

  type AnyTrack = MuxTrack | MuxTx3gTrack;
  const allTracks: AnyTrack[] = [...tracks, ...subtitleTracks];

  // ---- Payload ----
  const allPayload = concat(...allTracks.flatMap(t => t.frames));
  const mdat = box("mdat", allPayload);

  // ---- FTYP ----
  const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("mp42"));
  // const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("mp42"), str("im11"));

  // ---- Movie duration (max across tracks) in movieTimescale ----
  const durationsMv = allTracks.map(t => {
    const srcTs = (t as any).sampleRate ?? (t as any).timescale;
    return Math.round((t.mdhdDuration / srcTs) * movieTimescale);
  });
  const movieDurationMv = Math.max(...durationsMv, 0);

  // ---- Offsets ----
  let baseOffset = 0;
  if (layout === "ftyp-mdat-moov") {
    baseOffset = ftyp.length + 8; // first byte of mdat payload
  }

  const offsetsPerTrack: number[][] = [];
  let cursor = baseOffset;
  for (const t of allTracks) {
    const offsets: number[] = [];
    for (let i = 0; i < t.sizes.length; i++) {
      offsets.push(cursor);
      cursor += t.sizes[i];
    }
    offsetsPerTrack.push(offsets);
  }

  // ---- MPEG-7 XML (defaults if not provided) ----
  const albumXml =
    opts.albumXml ??
    (opts.albumMeta ? mpeg7AlbumXML(opts.albumMeta)
                    : mpeg7AlbumXML({ title: "Album", artist: "Various", genre: "Unknown", releaseDate: "2025-01-01" }));

  const songXml =
    opts.songXml ??
    (opts.songMeta ? mpeg7SongXML(opts.songMeta)
                   : mpeg7SongXML({ title: "Song", singer: "Unknown", releaseDate: "2025-01-01" }));

  const perTrackXml =
    opts.perTrackXml ??
    (opts.perTrackMeta
      ? opts.perTrackMeta.map(t => mpeg7TrackXML(t))
      : tracks.map((_, i) => mpeg7TrackXML({ title: `Track ${i + 1}` })));

  // ---- IMAF (optional) ----
  let grco = new Uint8Array(0), prco = new Uint8Array(0), ruco = new Uint8Array(0);
  if (includeImaf) {
    const elementIDs = tracks.map((_, i) => (i + 1) >>> 0);
    const spec = parseImafSpec(includeImaf);

    if (spec) {
      const groups: Group[] = spec.groups ?? [{
        groupID: 0x80000000 | 1,
        elementIDs,
        activationMode: 1,
        referenceVolume: 1.0,
        name: "All",
        description: "All tracks"
      }];

      const presets: Preset[] = spec.presets ?? [{
        presetID: 1,
        elementIDs,
        presetType: 0,
        globalVolumeIndex: 100,
        perElementVolumeIndex: elementIDs.map(() => 50),
        name: "Default Mix",
        flags: 0x02
      }];

      const selectionRules: SelectionRule[] = spec.selectionRules ?? [
        { id: 1, type: 0, elementID: groups[0].groupID, min: 1, max: elementIDs.length, desc: "At least 1 element active" }
      ];
      const mixingRules: MixingRule[] = spec.mixingRules ?? [
        { id: 1, type: 3, elementID: 1, minVol: 0.0, maxVol: 2.0, desc: "Track 1 volume 0.0..2.0" }
      ];
      const steps = spec.globalPresetSteps ?? 1;

      grco = groups.length ? grcoBox(groups) : new Uint8Array(0);
      prco = presets.length ? prcoBox(presets, steps) : new Uint8Array(0);
      ruco = (selectionRules.length || mixingRules.length) ? rucoBox(selectionRules, mixingRules) : new Uint8Array(0);
    } else {
      const groupAll: Group = {
        groupID: 0x80000000 | 1,
        elementIDs,
        activationMode: 1,
        referenceVolume: 1.0,
        name: "All",
        description: "All tracks"
      };
      grco = grcoBox([groupAll]);

      const preset: Preset = {
        presetID: 1,
        elementIDs,
        presetType: 0,
        globalVolumeIndex: 100,
        perElementVolumeIndex: elementIDs.map(() => 50),
        name: "Default Mix",
        flags: 0x02
      };
      prco = prcoBox([preset], 1);

      const selectionRules: SelectionRule[] = [
        { id: 1, type: 0, elementID: groupAll.groupID, min: 1, max: elementIDs.length, desc: "At least 1 element active" }
      ];
      const mixingRules: MixingRule[] = [
        { id: 1, type: 3, elementID: 1, minVol: 0.0, maxVol: 2.0, desc: "Track 1 volume 0.0..2.0" }
      ];
      ruco = rucoBox(selectionRules, mixingRules);
    }
  }

  // ---- traks (+ per-track meta) ----
  const traks = allTracks.map((t, i) => {
    const isSub = (t as any).kind === "tx3g";
    const mdia = isSub ? mdia_for_tx3g(t as MuxTx3gTrack, offsetsPerTrack[i])
                       : mdia_for_track(t as MuxTrack, offsetsPerTrack[i]);

    const trackTimescale = (t as any).sampleRate ?? (t as any).timescale;

    let trackXml: string;
    if (isSub) {
      trackXml = mpeg7TrackXML({ title: `Subtitle Track` });
    } else {
      const audioIdx = i; // allTracks = [...tracks, ...subtitleTracks]
      trackXml = perTrackXml[audioIdx] ?? mpeg7TrackXML({ title: `Audio Track ${audioIdx + 1}` });
    }

    return box(
      "trak",
      tkhd(i + 1, movieTimescale, t.mdhdDuration, trackTimescale),
      mdia,
      udta(metaBox("mp7t", `Track ${i + 1}`, xmlBox(trackXml)))
    );
  });

  // ---- moov + album meta ----
  const moovUdta = udta(metaBox("mp7t", "Song", xmlBox(songXml)));
  const moov = box("moov", mvhd(movieTimescale, movieDurationMv), ...traks, moovUdta, grco, prco, ruco);
  const albumMetaTop = metaBox("mp7t", "Album", xmlBox(albumXml));

  // ---- Assemble ----
  if (layout === "ftyp-mdat-moov") {
    return concat(ftyp, mdat, albumMetaTop, moov);
  } else {
    // PASS 1: draft moov with dummy offsets (audio-only here, mirroring original)
    const dummyOffsetsPerTrack: number[][] = tracks.map(t => new Array(t.sizes.length).fill(0));
    const traksDraft = tracks.map((t, i) => {
      const mdiaDraft = mdia_for_track(t, dummyOffsetsPerTrack[i]);
      const tmeta = metaBox("mp7t", `Track ${i + 1}`, xmlBox(perTrackXml[i]));
      return box("trak", tkhd(i + 1, movieTimescale, t.mdhdDuration, t.sampleRate), mdiaDraft, udta(tmeta));
    });
    const moovUdtaDraft = udta(metaBox("mp7t", "Song", xmlBox(songXml)));
    const moovDraft = box("moov", mvhd(movieTimescale, movieDurationMv), ...traksDraft, moovUdtaDraft, grco, prco, ruco);

    const baseOffset2 = ftyp.length + moovDraft.length + 8;

    // REAL offsets (audio-only, same as original branch)
    const offsetsPerTrack2: number[][] = [];
    let cursor2 = baseOffset2;
    for (const t of tracks) {
      const offsets: number[] = [];
      for (let i = 0; i < t.sizes.length; i++) { offsets.push(cursor2); cursor2 += t.sizes[i]; }
      offsetsPerTrack2.push(offsets);
    }

    // PASS 2: final moov
    const traksFinal = tracks.map((t, i) => {
      const mdia = mdia_for_track(t, offsetsPerTrack2[i]);
      const tmeta = metaBox("mp7t", `Track ${i + 1}`, xmlBox(perTrackXml[i]));
      return box("trak", tkhd(i + 1, movieTimescale, t.mdhdDuration, t.sampleRate), mdia, udta(tmeta));
    });
    const moovUdtaFinal = udta(metaBox("mp7t", "Song", xmlBox(songXml)));
    const moovFinal = box("moov", mvhd(movieTimescale, movieDurationMv), ...traksFinal, moovUdtaFinal, grco, prco, ruco);

    return concat(ftyp, moovFinal, mdat, albumMetaTop);
  }
}