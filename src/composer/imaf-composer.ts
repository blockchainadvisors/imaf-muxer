// src/composer/imaf-composer.ts
import { box, str, u32 } from "../iso/bytes";
import { mvhd, tkhd, mdia_for_track, type MuxTrack } from "../iso/audio";
import { metaBox, xmlBox, udta } from "../iso/meta";
import { grcoBox, prcoBox, rucoBox, type Group, type Preset, type SelectionRule, type MixingRule } from "../iso/imaf";
import { mpeg7AlbumXML, mpeg7SongXML, mpeg7TrackXML } from "../iso/mpeg7";
import type { MuxTx3gTrack } from "../iso/subtitle";
import { mdia_for_tx3g } from "../iso/subtitle";

export type ComposeOptions = {
    // File layout (you said you want moov at the end for now)
    layout?: "ftyp-mdat-moov" | "ftyp-moov-mdat";
    movieTimescale?: number;

    // MPEG-7 (pass your own XML strings if you like)
    albumXml?: string;
    songXml?: string;
    perTrackXml?: string[];

    // IMAF (set false to skip)
    includeImaf?: boolean;

    subtitleTracks?: MuxTx3gTrack[];
};

export function composeImaf(tracks: MuxTrack[], opts: ComposeOptions = {}): Buffer {
    const {
        layout = "ftyp-mdat-moov",
        movieTimescale = 1000,
        includeImaf = true,
        subtitleTracks = []
    } = opts;

    // Merge audio + subtitle for payload/offsets
    type AnyTrack = MuxTrack | MuxTx3gTrack;
    const allTracks: AnyTrack[] = [...tracks, ...subtitleTracks];

    // ---- Payload ----
    const allPayload = Buffer.concat(
        allTracks.flatMap(t => t.frames.map(f => Buffer.from(f.buffer, f.byteOffset, f.byteLength)))
    );
    const mdat = box("mdat", allPayload);

    // ---- FTYP ----
    const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("mp42"));
    // const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("mp42"), str("im11"));

    // ---- Timing ----
    // ---- Movie duration: max across all tracks, converted to movieTimescale
    const durationsMv = allTracks.map(t => {
        // audio: mdhd units = sampleRate; subs: mdhd units = timescale
        const srcTs = (t as any).sampleRate ?? (t as any).timescale;
        return Math.round((t.mdhdDuration / srcTs) * movieTimescale);
    });

    const movieDurationMv = Math.max(...durationsMv, 0);

    // ---- Offsets (we'll support both layouts) ----
    let baseOffset = 0;
    if (layout === "ftyp-mdat-moov") {
        // mdat comes right after ftyp; chunk offsets are relative to the start of mdat payload
        baseOffset = ftyp.length + 8;
    }

    // Compute offsets per track
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
    const albumXml = opts.albumXml ?? mpeg7AlbumXML({ title: "Album", artist: "Various", genre: "Unknown", releaseDate: "2025-01-01" });
    const songXml = opts.songXml ?? mpeg7SongXML({ title: "Song", singer: "Unknown", releaseDate: "2025-01-01" });
    const perTrackXml = opts.perTrackXml ?? tracks.map((_, i) => mpeg7TrackXML({ title: `Audio Track ${i + 1}` }));

    // ---- IMAF (optional, simple defaults) ----
    let grco = Buffer.alloc(0), prco = Buffer.alloc(0), ruco = Buffer.alloc(0);
    if (includeImaf) {
        const groupAll: Group = {
            groupID: 0x80000000 | 1,
            elementIDs: tracks.map((_, i) => (i + 1) >>> 0),
            activationMode: 1,
            referenceVolume: 1.0,
            name: "All",
            description: "All tracks"
        };
        grco = grcoBox([groupAll]);

        const preset: Preset = {
            presetID: 1,
            elementIDs: tracks.map((_, i) => (i + 1) >>> 0),
            presetType: 0,
            globalVolumeIndex: 100,
            perElementVolumeIndex: tracks.map(() => 50),
            name: "Default Mix",
            flags: 0x02
        };
        prco = prcoBox([preset], 1);

        const selectionRules: SelectionRule[] = [
            { id: 1, type: 0, elementID: groupAll.groupID, min: 1, max: groupAll.elementIDs.length, desc: "At least 1 element active" }
        ];
        const mixingRules: MixingRule[] = [
            { id: 1, type: 3, elementID: 1, minVol: 0.0, maxVol: 2.0, desc: "Track 1 volume 0.0..2.0" }
        ];
        ruco = rucoBox(selectionRules, mixingRules);
    }

    // ---- Build traks (+ per-track meta) ----
    const traks = allTracks.map((t, i) => {
        const isSub = (t as any).kind === "tx3g";
        const mdia = isSub ? mdia_for_tx3g(t as MuxTx3gTrack, offsetsPerTrack[i])
            : mdia_for_track(t as MuxTrack, offsetsPerTrack[i]);

        const trackTimescale = (t as any).sampleRate ?? (t as any).timescale;
        const tk = box(
            "trak",
            tkhd(i + 1, movieTimescale, t.mdhdDuration, trackTimescale),
            mdia,
            // Per-track MPEG-7 (keep your existing tracking)
            udta(metaBox("mp7t", `Track ${i + 1}`, xmlBox(perTrackXml[i] ?? mpeg7TrackXML({ title: `Track ${i + 1}` }))))
        );
        return tk;
    });

    // ---- moov (with song meta + IMAF) ----
    const moovUdta = udta(metaBox("mp7t", "Song", xmlBox(songXml)));
    const moov = box(
        "moov",
        mvhd(movieTimescale, movieDurationMv),
        ...traks,
        moovUdta,
        grco, prco, ruco
    );

    // ---- Album (root) ----
    const albumMetaTop = metaBox("mp7t", "Album", xmlBox(albumXml));

    // ---- Assemble by layout ----
    if (layout === "ftyp-mdat-moov") {
        // prefer writing moov at the end to avoid recalculating offsets
        return Buffer.concat([ftyp, mdat, albumMetaTop, moov]);
    } else {
        // ---------- PASS 1: build a draft moov with DUMMY chunk offsets ----------
        const dummyOffsetsPerTrack: number[][] = tracks.map(t => new Array(t.sizes.length).fill(0));

        const traksDraft: Buffer[] = tracks.map((t, i) => {
            const mdiaDraft = mdia_for_track(t, dummyOffsetsPerTrack[i]);
            const tmeta = metaBox("mp7t", `Track ${i + 1}`, xmlBox(perTrackXml[i]));
            return box(
                "trak",
                tkhd(i + 1, movieTimescale, t.mdhdDuration, t.sampleRate),
                mdiaDraft,
                udta(tmeta)
            );
        });

        const moovUdtaDraft = udta(metaBox("mp7t", "Song", xmlBox(songXml)));
        const moovDraft = box(
            "moov",
            mvhd(movieTimescale, movieDurationMv),
            ...traksDraft,
            moovUdtaDraft,
            grco, prco, ruco // (these are Buffers; empty if includeImaf=false)
        );

        // Base offset for stco when moov precedes mdat:
        // [ftyp][moov][mdat], so the first mdat payload byte lives at ftyp.length + moovDraft.length + 8
        const baseOffset2 = ftyp.length + moovDraft.length + 8;

        // ---------- Compute REAL chunk offsets ----------
        const offsetsPerTrack2: number[][] = [];
        let cursor2 = baseOffset2;
        for (const t of tracks) {
            const offsets: number[] = [];
            for (let i = 0; i < t.sizes.length; i++) {
                offsets.push(cursor2);
                cursor2 += t.sizes[i];
            }
            offsetsPerTrack2.push(offsets);
        }

        // ---------- PASS 2: rebuild traks + FINAL moov with correct stco ----------
        const traksFinal: Buffer[] = tracks.map((t, i) => {
            const mdia = mdia_for_track(t, offsetsPerTrack2[i]);
            const tmeta = metaBox("mp7t", `Track ${i + 1}`, xmlBox(perTrackXml[i]));
            return box(
                "trak",
                tkhd(i + 1, movieTimescale, t.mdhdDuration, t.sampleRate),
                mdia,
                udta(tmeta)
            );
        });

        const moovUdtaFinal = udta(metaBox("mp7t", "Song", xmlBox(songXml)));
        const moovFinal = box(
            "moov",
            mvhd(movieTimescale, movieDurationMv),
            ...traksFinal,
            moovUdtaFinal,
            grco, prco, ruco
        );

        // ---------- Assemble in ftyp-moov-mdat order ----------
        return Buffer.concat([ftyp, moovFinal, mdat, albumMetaTop]);
    }
}