//src/codecs/wav-pcm.ts - parse WAV PCM files to get raw PCM frames and build MP4 sample entry - Experimental
import { box, u16, u32 } from '../iso/bytes';

/** WAV 'fmt ' chunk essentials for PCM/IEEE float. */
type WavFmt = {
  /** 1=PCM (integer), 3=IEEE float. */
  audioFormat: 1 | 3;
  /** Channel count (1=mono, 2=stereo, ...). */
  channelCount: number;
  /** Sampling rate in Hz. */
  sampleRate: number;
  /** Bits per sample (8/16/24/32). */
  bitsPerSample: number;
  /** Bytes per second (rate * blockAlign). */
  byteRate: number;
  /** Block alignment in bytes (channels * bytesPerSample). */
  blockAlign: number;
};

/** Little-endian U32 reader. */
function readU32(u: DataView, o: number) { return u.getUint32(o, true); }
/** Little-endian U16 reader. */
function readU16(u: DataView, o: number) { return u.getUint16(o, true); }

/**
 * Parse a WAV file buffer into framed PCM suitable for MP4/IMAF muxing.
 *
 * @param buf - Input WAV file as Uint8Array (Node Buffer also works; it's a Uint8Array)
 * @param frameSamples - Number of PCM samples per output frame (default: 1024)
 */
export function parseWavFile(buf: Uint8Array, frameSamples = 1024) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (dv.getUint32(0, false) !== 0x52494646) throw new Error('Not RIFF'); // 'RIFF'
  if (dv.getUint32(8, false) !== 0x57415645) throw new Error('Not WAVE'); // 'WAVE'

  let off = 12;
  let fmt: WavFmt | null = null;
  let dataStart = -1, dataSize = 0;

  while (off + 8 <= dv.byteLength) {
    const id = dv.getUint32(off, false);
    const sz = readU32(dv, off + 4);
    off += 8;
    if (id === 0x666d7420) { // 'fmt '
      const audioFormat = readU16(dv, off) as 1 | 3;
      const channelCount = readU16(dv, off + 2);
      const sampleRate = readU32(dv, off + 4);
      const byteRate = readU32(dv, off + 8);
      const blockAlign = readU16(dv, off + 12);
      const bitsPerSample = readU16(dv, off + 14);
      fmt = { audioFormat, channelCount, sampleRate, bitsPerSample, byteRate, blockAlign };
    } else if (id === 0x64617461) { // 'data'
      dataStart = off;
      dataSize = sz;
    }
    off += sz + (sz & 1); // padding
  }

  if (!fmt) throw new Error('Missing fmt chunk');
  if (dataStart < 0) throw new Error('Missing data chunk');

  const raw = new Uint8Array(buf.buffer, buf.byteOffset + dataStart, dataSize);
  const bytesPerSample = fmt.bitsPerSample >> 3;

  // Frame the PCM into BMFF "samples"
  const frameBytes = frameSamples * fmt.channelCount * bytesPerSample;
  const frames: Uint8Array[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < raw.length; i += frameBytes) {
    const size = Math.min(frameBytes, raw.length - i);
    frames.push(raw.slice(i, i + size));
    sizes.push(size);
  }

  const makeSampleEntry = () => buildLpcmEntry(fmt);

  return {
    codec: 'pcm' as const,
    sampleRate: fmt.sampleRate,
    channelCount: fmt.channelCount,
    mdhdTimescale: fmt.sampleRate,
    samplesPerFrame: frameSamples,
    frames, sizes,
    makeSampleEntry,
  };
}

/**
 * Build a minimal 'lpcm' sample entry for MP4/QuickTime containers.
 *
 * @param fmt - WAV format info
 */
function buildLpcmEntry(fmt: WavFmt) {
  // QuickTime-style 'lpcm' sample entry:
  // version fields + channelCount/bits/sampleRate, + 'lpcm' specific fields in the extension
  const reserved6 = new Uint8Array(6);
  const dataRefIdx = u16(1);
  const version = u16(0), revision = u16(0), vendor = u32(0);
  const channelCount = u16(fmt.channelCount);
  const sampleSize = u16(fmt.bitsPerSample);
  const compressionId = u16(0);
  const packetSize = u16(0);
  const sampleRate1616 = u32(fmt.sampleRate << 16);

  // Minimal entry for broad compatibility.
  return box('lpcm',
    reserved6, dataRefIdx,
    version, revision, vendor,
    channelCount, sampleSize, compressionId, packetSize,
    sampleRate1616
  );
}
