//src/lib/adts.ts - parse ADTS AAC files to get raw AAC frames and AudioSpecificConfig
export type AacTrack = {
  sampleRate: number;
  channelConfig: number;
  asc: Buffer;
  frames: Buffer[];
  sizes: number[];
  totalBytes: number;
  frameCount: number;
  mdhdDuration: number;
};

const samplingFreqIndexToRate: Record<number, number> = {
  0: 96000, 1: 88200, 2: 64000, 3: 48000, 4: 44100, 5: 32000,
  6: 24000, 7: 22050, 8: 16000, 9: 12000, 10: 11025, 11: 8000,
  12: 7350
};

export function parseAdtsFile(buf: Buffer): AacTrack {
  let off = 0; let sampleRate = 0, channelConfig = 2;
  const frames: Buffer[] = []; const sizes: number[] = [];
  let frameCount = 0; let totalBytes = 0; let asc: Buffer | null = null;

  while (off + 7 <= buf.length) {
    if (buf.readUInt16BE(off) >> 4 !== 0x0FFF) break;
    const protectionAbsent = buf[off + 1] & 0x01;
    const profile = (buf[off + 2] >> 6) & 0x03;
    const sfIndex = (buf[off + 2] >> 2) & 0x0F;
    const chanCfg = ((buf[off + 2] & 0x01) << 2) | ((buf[off + 3] >> 6) & 0x03);
    const frameLength = ((buf[off + 3] & 0x03) << 11) | (buf[off + 4] << 3) | ((buf[off + 5] >> 5) & 0x07);
    if (off + frameLength > buf.length) break;

    if (!asc) {
      sampleRate = samplingFreqIndexToRate[sfIndex] || 48000;
      channelConfig = chanCfg;
      const aot = profile + 1;
      const b0 = (aot << 3) | ((sfIndex & 0x0E) >> 1);
      const b1 = ((sfIndex & 0x01) << 7) | ((channelConfig & 0x0F) << 3);
      asc = Buffer.from([b0, b1]);
    }

    const headerLen = protectionAbsent ? 7 : 9;
    const aacPayload = buf.subarray(off + headerLen, off + frameLength);
    frames.push(aacPayload); sizes.push(aacPayload.length);
    totalBytes += aacPayload.length; frameCount++; off += frameLength;
  }
  if (!asc || frameCount === 0) throw new Error('No ADTS frames found');

  return { sampleRate, channelConfig, asc, frames, sizes, totalBytes, frameCount, mdhdDuration: frameCount * 1024 };
}
