// src/codecs/adts.ts - parse ADTS AAC files to get raw AAC frames and AudioSpecificConfig

/** Parsed AAC (ADTS) track info for muxing. */
export type AacTrack = {
  /** Sampling rate in Hz (from samplingFrequencyIndex). */
  sampleRate: number;
  /** Channel configuration (1=mono, 2=stereo, etc.). */
  channelConfig: number;
  /** AudioSpecificConfig (ASC) bytes. */
  asc: Uint8Array;
  /** Raw AAC frame payloads (ADTS headers stripped). */
  frames: Uint8Array[];
  /** Byte size of each frame in `frames`. */
  sizes: number[];
  /** Sum of all frame bytes. */
  totalBytes: number;
  /** Number of frames parsed. */
  frameCount: number;
  /** mdhd duration in AAC samples (1024 per frame). */
  mdhdDuration: number;
};

const samplingFreqIndexToRate: Record<number, number> = {
  0: 96000, 1: 88200, 2: 64000, 3: 48000, 4: 44100, 5: 32000,
  6: 24000, 7: 22050, 8: 16000, 9: 12000, 10: 11025, 11: 8000,
  12: 7350
};

/**
 * Parse an ADTS AAC buffer into raw frames and build ASC.
 * Strips ADTS headers; derives sampleRate/channelConfig from the first frame.
 * @param buf ADTS file contents (Uint8Array).
 * @returns AacTrack with frames, sizes, ASC, and basic stats.
 * @throws If no valid ADTS frames are found.
 */
export function parseAdtsFile(buf: Uint8Array): AacTrack {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let off = 0; let sampleRate = 0, channelConfig = 2;
  const frames: Uint8Array[] = []; const sizes: number[] = [];
  let frameCount = 0; let totalBytes = 0; let asc: Uint8Array | null = null;

  while (off + 7 <= buf.length) {
    // syncword 0xFFF (12 bits) → high 12 bits of first 16 bits are all 1
    if ((dv.getUint16(off, false) >> 4) !== 0x0FFF) break;

    const protectionAbsent = buf[off + 1] & 0x01;
    const profile = (buf[off + 2] >> 6) & 0x03;
    const sfIndex = (buf[off + 2] >> 2) & 0x0F;
    const chanCfg = ((buf[off + 2] & 0x01) << 2) | ((buf[off + 3] >> 6) & 0x03);

    const frameLength =
      ((buf[off + 3] & 0x03) << 11) |
      (buf[off + 4] << 3) |
      ((buf[off + 5] >> 5) & 0x07);

    if (frameLength < 7 || off + frameLength > buf.length) break;

    if (!asc) {
      sampleRate = samplingFreqIndexToRate[sfIndex] || 48000;
      channelConfig = chanCfg;
      const aot = profile + 1; // AAC LC etc.
      const b0 = (aot << 3) | ((sfIndex & 0x0E) >> 1);
      const b1 = ((sfIndex & 0x01) << 7) | ((channelConfig & 0x0F) << 3);
      asc = new Uint8Array([b0 & 0xFF, b1 & 0xFF]);
    }

    const headerLen = protectionAbsent ? 7 : 9;
    const start = off + headerLen;
    const end = off + frameLength;
    const aacPayload = buf.subarray(start, end);

    frames.push(aacPayload);
    sizes.push(aacPayload.length);
    totalBytes += aacPayload.length;
    frameCount++;
    off += frameLength;
  }

  if (!asc || frameCount === 0) throw new Error('No ADTS frames found');

  return {
    sampleRate,
    channelConfig,
    asc,
    frames,
    sizes,
    totalBytes,
    frameCount,
    mdhdDuration: frameCount * 1024,
  };
}
