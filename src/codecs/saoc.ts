//src/codecs/saoc.ts - parse SAOC elementary stream with sidecar ASC, build MP4 sample entry - Experimental
import { box, u16, u32, concat } from '../iso/bytes';
import * as fs from 'node:fs';

/** Options for SAOC parsing with external AudioSpecificConfig. */
export type SaocOptions = {
    /** Path to .asc text (hex or base64). */
    ascPath: string;               // sidecar AudioSpecificConfig (.asc) as hex or base64
    /** Samples per frame; defaults to 1024. */
    samplesPerFrame?: number;      // default 1024
};
/**
 * Build an ISO/IEC 14496-1 ESDS box.
 * @param objectTypeIndication OTI (e.g., 0x40 for AAC/SAOC).
 * @param dsi DecoderSpecificInfo payload (ASC bytes).
 * @returns 'esds' MP4 box.
 */
function buildEsds(objectTypeIndication: number, dsi: Uint8Array) {
    // ES_Descriptor(03) -> DecoderConfig(04) -> DecSpecificInfo(05)
    const tag = (t: number, payload: Uint8Array) => new Uint8Array([t, ...vlen(payload.length), ...payload]);
    const vlen = (n: number) => {
        const a = [];
        do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; a.push(b); } while (n);
        return a;
    };

    const decSpecificInfo = tag(0x05, dsi);
    const decoderConfig = tag(0x04, concat(
        Buffer.from([objectTypeIndication, 0x15, 0x00, 0x00, 0x00, 0x00]), // stream type=audio(0x05)<<2|1 + buffers
        Buffer.from(decSpecificInfo)
    ));
    const esDescriptor = tag(0x03, concat(
        Buffer.from([0x00, 0x00]), // ES_ID=0
        Buffer.from([0x00]),       // flags
        Buffer.from(decoderConfig)
    ));
    const esdsPayload = concat(
        Buffer.from([0x00, 0x00, 0x00]), // version+flags
        Buffer.from(esDescriptor)
    );
    return box('esds', esdsPayload);
}

/**
 * Parse SAOC elementary stream with sidecar ASC and provide MP4 sample entry.
 * Assumes 4-byte big-endian AU length prefixes.
 * @param raw Raw input buffer (length-prefixed AUs).
 * @param opts { ascPath, samplesPerFrame? }
 * @returns Track info, frames/sizes, and sample entry builder.
 */
export function parseSaocElementaryStream(raw: Buffer, opts: SaocOptions) {
    const u = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

    // Split into frames: here we assume a simple framing file with 4-byte BE lengths before each AU.
    // If your input is a flat concatenation, replace with your own splitter (or use LATM parser).
    const frames: Uint8Array[] = [];
    const sizes: number[] = [];
    let off = 0;
    while (off + 4 <= u.length) {
        const size = (u[off] << 24) | (u[off + 1] << 16) | (u[off + 2] << 8) | u[off + 3];
        off += 4;
        frames.push(u.slice(off, off + size));
        sizes.push(size);
        off += size;
    }

    const asc = readAsc(opts.ascPath);  // Uint8Array
    const { sampleRate, channelCount, samplesPerFrame } = inferFromAsc(asc, opts.samplesPerFrame ?? 1024);

    const makeSampleEntry = () => {
        // mp4a + esds with OTI=0x40 and SAOC ASC as DecSpecificInfo
        const DATA_REF_INDEX = u16(1);
        const reserved6 = Buffer.alloc(6); // reserved
        const channelCountU16 = u16(channelCount);
        const sampleSize = u16(16);
        const preDefined = u16(0);
        const reserved2 = u16(0);
        const sampleRate1616 = u32(sampleRate << 16);

        const esds = buildEsds(0x40, asc);
        return box('mp4a',
            reserved6, DATA_REF_INDEX,
            u32(0), u32(0), u32(0),
            channelCountU16, sampleSize, preDefined, reserved2,
            sampleRate1616,
            esds
        );
    };

    return {
        codec: 'saoc' as const,
        sampleRate,
        channelCount,
        mdhdTimescale: sampleRate,
        samplesPerFrame,
        frames, sizes,
        makeSampleEntry,
    };
}

/**
 * Read sidecar ASC text file as bytes (hex or base64).
 * @param path Path to .asc file.
 * @returns ASC as Uint8Array.
 */
function readAsc(path: string): Uint8Array {
    const txt = fs.readFileSync(path, 'utf8').trim();
    const isHex = /^[0-9a-fA-F]+$/.test(txt.replace(/\s+/g, ''));
    if (isHex) {
        const cleaned = txt.replace(/\s+/g, '');
        const out = new Uint8Array(cleaned.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
        return out;
    }
    // else assume base64
    return new Uint8Array(Buffer.from(txt, 'base64'));
}

/**
 * Minimal inference from ASC; caller may override via opts.
 * @param asc Raw ASC bytes.
 * @param defaultSpf Fallback samples per frame.
 * @returns { sampleRate, channelCount, samplesPerFrame }
 */
function inferFromAsc(asc: Uint8Array, defaultSpf: number) {
    // Most SAOC configs are based on AAC core with 1024 samples.
    // If you want, I can add a proper ASC parser to extract samplingFrequencyIndex and channelConfig.
    return { sampleRate: 48000, channelCount: 2, samplesPerFrame: defaultSpf };
}