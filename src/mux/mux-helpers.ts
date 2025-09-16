// src/mux/mux-helpers.ts
import {
    parseAdtsFile, parseMp3File, parseWavFile, parseSaocElementaryStream,
    parseSrt, buildTx3gTrack, extractTx3gMuxTracks,
    mp4aSampleEntry,
    type MuxTrack, type MuxTx3gTrack,
} from "../index";

/** Named buffer input. */
export type InputFile = { name: string; buf: Buffer };

/** Muxer build options. */
export type MuxBuildOptions = {
    /** PCM samples per frame (default 1024). */
    pcmFrame?: number;
    /** Path to SAOC ASC when .saoc is present. */
    saocAscPath?: string;
};

export type NormalizedAlbumMeta = {
    title: string; artist: string; genre?: string; releaseDate?: string;
    production?: string; publisher?: string; copyright?: string;
    coverUrl?: string; siteUrl?: string;
};
export type NormalizedSongMeta = {
    title: string; singer?: string; composer?: string; lyricist?: string;
    genre?: string; releaseDate?: string; production?: string; publisher?: string;
    copyright?: string; isrc?: string; cdTrackNo?: string; imageUrl?: string; siteUrl?: string;
};
export type NormalizedTrackMeta = {
    title?: string; performer?: string; recordedAt?: string;
};

/** Composer-ready metadata bundle. */
export type NormalizedMeta = {
    albumMeta?: NormalizedAlbumMeta;
    songMeta?: NormalizedSongMeta;
    perTrackMeta?: NormalizedTrackMeta[];
};

/**
 * Detect input kind from filename.
 * @param filename Path or basename.
 */
export function detectKind(filename: string): "aac" | "mp3" | "pcm" | "saoc" | "srt" | "3gp" {
    const q = filename.toLowerCase();
    if (q.endsWith(".aac") || q.endsWith(".adts")) return "aac";
    if (q.endsWith(".mp3")) return "mp3";
    if (q.endsWith(".wav") || q.endsWith(".pcm")) return "pcm";
    if (q.endsWith(".saoc") || q.endsWith(".loas") || q.endsWith(".latm")) return "saoc";
    if (q.endsWith(".srt")) return "srt";
    if (q.endsWith(".3gp") || q.endsWith(".mp4")) return "3gp";
    throw new Error(`Unknown input format: ${filename}`);
}

/**
 * Guess language (ISO-639-2) from *.xx.srt suffix.
 * @param filename Subtitle filename.
 */
export function guessLangFromFilename(filename: string): string | undefined {
    const m = filename.toLowerCase().match(/\.([a-z]{2,3})\.srt$/);
    return m?.[1];
}


/**
 * Build audio + subtitle tracks from buffers.
 * @param inputs Audio/containers.
 * @param subtitles SRT/3GP subtitle sources.
 * @param opts Frame sizes, SAOC ASC path.
 */
export function buildTracksFromInputs(
    inputs: InputFile[],
    subtitles: InputFile[],
    opts: MuxBuildOptions = {}
): { tracks: MuxTrack[]; subtitleTracks: MuxTx3gTrack[] } {
    const PCM_FRAME = Number(opts.pcmFrame ?? 1024);
    const SAOC_ASC = opts.saocAscPath;

    const tracks: MuxTrack[] = [];
    const subtitleTracks: MuxTx3gTrack[] = [];

    const handleOne = (f: InputFile) => {
        const kind = detectKind(f.name);
        if (kind === "aac") {
            const a = parseAdtsFile(f.buf);
            tracks.push({
                sampleRate: a.sampleRate,
                mdhdDuration: a.mdhdDuration,
                frames: a.frames,
                sizes: a.sizes,
                frameCount: a.frameCount,
                samplesPerFrame: 1024,
                makeSampleEntry: () => mp4aSampleEntry(a.sampleRate, a.channelConfig, a.asc),
            });
            return;
        }
        if (kind === "mp3") {
            const m = parseMp3File(f.buf);
            tracks.push({
                sampleRate: m.sampleRate,
                mdhdDuration: m.frames.length * m.samplesPerFrame,
                frames: m.frames,
                sizes: m.sizes,
                frameCount: m.frames.length,
                samplesPerFrame: m.samplesPerFrame,
                makeSampleEntry: () => Buffer.from(m.makeSampleEntry()),
            });
            return;
        }
        if (kind === "pcm") {
            const w = parseWavFile(f.buf, PCM_FRAME);
            tracks.push({
                sampleRate: w.sampleRate,
                mdhdDuration: w.frames.length * w.samplesPerFrame,
                frames: w.frames,
                sizes: w.sizes,
                frameCount: w.frames.length,
                samplesPerFrame: w.samplesPerFrame,
                makeSampleEntry: () => Buffer.from(w.makeSampleEntry()),
            });
            return;
        }
        if (kind === "saoc") {
            if (!SAOC_ASC) throw new Error(`SAOC input "${f.name}" requires SAOC_ASC (AudioSpecificConfig)`);
            const s = parseSaocElementaryStream(f.buf, { ascPath: SAOC_ASC });
            tracks.push({
                sampleRate: s.sampleRate,
                mdhdDuration: s.frames.length * s.samplesPerFrame,
                frames: s.frames,
                sizes: s.sizes,
                frameCount: s.frames.length,
                samplesPerFrame: s.samplesPerFrame ?? 1024,
                makeSampleEntry: () => Buffer.from(s.makeSampleEntry()),
            });
            return;
        }
        if (kind === "srt") {
            const cues = parseSrt(f.buf.toString("utf8"));
            const lang = guessLangFromFilename(f.name) ?? "eng";
            subtitleTracks.push(buildTx3gTrack(cues, { timescale: 1000, language: lang }));
            return;
        }
        if (kind === "3gp") {
            const ab = f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.byteLength);
            const muxSubs = extractTx3gMuxTracks(ab);
            if (!muxSubs.length) throw new Error(`No tx3g tracks found in ${f.name}`);
            subtitleTracks.push(...muxSubs);
            return;
        }
    };

    inputs.forEach(handleOne);
    subtitles.forEach(handleOne);
    return { tracks, subtitleTracks };
}


/**
 * Parse CLI JSON meta and normalize for composer.
 * @param metaJsonText Raw JSON string or undefined.
 */
export function normalizeCliMeta(metaJsonText?: string): NormalizedMeta {
    if (!metaJsonText || !metaJsonText.trim()) return {};

    // Intentionally parse here (library, not the script):
    const raw = JSON.parse(metaJsonText) as any;

    const albumRaw = raw?.album;
    const songRaw = raw?.song;
    const tracksRaw = Array.isArray(raw?.tracks) ? raw.tracks : undefined;

    const albumMeta = albumRaw ? {
        title: albumRaw.title,
        artist: albumRaw.artist,
        genre: albumRaw.genre,
        releaseDate: albumRaw.releaseDate,
        production: albumRaw.production,
        publisher: albumRaw.publisher,
        copyright: albumRaw.copyright,
        coverUrl: albumRaw.coverUrl ?? albumRaw.image ?? undefined,
        siteUrl: albumRaw.siteUrl,
    } as NormalizedAlbumMeta : undefined;

    const songMeta = songRaw ? {
        title: songRaw.title,
        singer: songRaw.singer,
        composer: songRaw.composer,
        lyricist: songRaw.lyricist,
        genre: songRaw.genre,
        releaseDate: songRaw.releaseDate,
        production: songRaw.production,
        publisher: songRaw.publisher,
        copyright: songRaw.copyright,
        isrc: songRaw.isrc,
        cdTrackNo: (songRaw.cdTrackNo ?? songRaw.cdTrackNumber)?.toString(),
        imageUrl: songRaw.imageUrl ?? songRaw.image ?? undefined,
        siteUrl: songRaw.siteUrl,
    } as NormalizedSongMeta : undefined;

    const perTrackMeta = tracksRaw?.map((t: any, i: number) => {
        const src = (t && typeof t === "object" && "meta" in t) ? t.meta : t;
        return {
            title: src?.title ?? `Track ${i + 1}`,
            performer: src?.performer ?? src?.performerName,
            recordedAt: src?.recordedAt ?? src?.recordingDateTime,
        } as NormalizedTrackMeta;
    });

    return { albumMeta, songMeta, perTrackMeta };
}


/**
 * Resolve includeImaf input: JSON text takes precedence; else legacy boolean.
 * @returns boolean | string | undefined
 */
export function resolveIncludeImaf(imafJsonText?: string, legacyIncludeImaf?: boolean): boolean | string | undefined {
    if (imafJsonText != null) return imafJsonText;   // keep JSON text as-is (composer parses)
    if (legacyIncludeImaf != null) return Boolean(legacyIncludeImaf);
    return undefined;
}
