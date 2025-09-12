//src/iso/imaf.ts - IMAF boxes (groups, presets, rules) - see IMAF spec v1.0
import { u8, u16, u32, i16, box, cstr, full } from './bytes';

// Narrow a numeric byte/word to a literal-union from an allowed set.
function clampLiteral<T extends readonly number[]>(
  n: number,
  allowed: T,
  fallback: T[number]
): T[number] {
  return (allowed as readonly number[]).includes(n) ? (n as T[number]) : fallback;
}

// Specific helpers for your IMAF schema:
function asActivationMode(n: number): 0 | 1 | 2 {
  const v = clampLiteral(n, [0, 1, 2] as const, 0);
  if (v !== n) console.warn(`[imaf] invalid activationMode=${n}; clamped to ${v}`);
  return v;
}

// If your Preset.presetType is 0 | 1:
function asPresetType(n: number): 0 {
  if (n !== 0) console.warn(`[imaf] unsupported presetType=${n}; forced to 0`);
  return 0 as 0;
}

// If your SelectionRule.type is a single literal 0 in your writer:
function asSelectionRuleType(n: number): 0 {
  const v = clampLiteral(n, [0] as const, 0);
  if (v !== n) console.warn(`[imaf] invalid selectionRule.type=${n}; forced to ${v}`);
  return v;
}

// If your MixingRule.type is a single literal 3 in your writer:
function asMixingRuleType(n: number): 3 {
  const v = clampLiteral(n, [3] as const, 3);
  if (v !== n) console.warn(`[imaf] invalid mixingRule.type=${n}; forced to ${v}`);
  return v;
}

// Groups
export type Group = {
  groupID: number;               // MSB=1
  elementIDs: number[];
  activationMode: 0 | 1 | 2;
  activationCount?: number;
  referenceVolume: number;       // 8.8 signed
  name: string;
  description: string;
};

export function grupBox(g: Group, flags = 0x02) {
  const elems = Buffer.alloc(4 * g.elementIDs.length);
  g.elementIDs.forEach((id, i) => elems.writeUInt32BE(id >>> 0, i * 4));
  const parts: Buffer[] = [
    full(0, flags),
    u32(g.groupID >>> 0),
    u16(g.elementIDs.length),
    elems,
    u8(g.activationMode),
  ];
  if (g.activationMode === 2) parts.push(u16(g.activationCount ?? 0));
  parts.push(i16(Math.round(g.referenceVolume * 256) | 0));
  parts.push(cstr(g.name), cstr(g.description));
  return box('grup', ...parts);
}
export const grcoBox = (groups: Group[]) => box('grco', u16(groups.length), ...groups.map(grupBox));

// Presets (type 0 static volumes)
export type Preset = {
  presetID: number;
  elementIDs: number[];
  presetType: 0;
  globalVolumeIndex: number;
  perElementVolumeIndex: number[];
  name: string;
  flags?: number;
};
export function prstBox(p: Preset) {
  if (p.perElementVolumeIndex.length !== p.elementIDs.length) throw new Error('perElementVolumeIndex length mismatch');
  const elemIDs = Buffer.alloc(4 * p.elementIDs.length);
  p.elementIDs.forEach((id, i) => elemIDs.writeUInt32BE(id >>> 0, i * 4));
  const perElem = Buffer.from(p.perElementVolumeIndex.map(x => (x | 0) & 0xff));
  return box('prst',
    full(0, p.flags ?? 0x02),
    u8(p.presetID & 0xff),
    u8(p.elementIDs.length & 0xff),
    elemIDs,
    u8(p.presetType),
    u8(p.globalVolumeIndex & 0xff),
    perElem,
    cstr(p.name)
  );
}
export const prcoBox = (presets: Preset[], defaultPresetID: number) =>
  box('prco', u8(presets.length & 0xff), u8(defaultPresetID & 0xff), ...presets.map(prstBox));

// Rules (selection + mixing)
export type SelectionRule =
  | { id: number; type: 0; elementID: number; min: number; max: number; desc: string }
  | { id: number; type: 1; elementID: number; keyElementID: number; desc: string }
  | { id: number; type: 2; elementID: number; desc: string }
  | { id: number; type: 3; elementID: number; keyElementID: number; desc: string };
export function ruscBox(r: SelectionRule) {
  const common = [full(0, 0), u16(r.id & 0xffff), u8(r.type & 0xff), u32(r.elementID >>> 0)];
  if (r.type === 0) return box('rusc', ...common, u16(r.min & 0xffff), u16(r.max & 0xffff), cstr(r.desc));
  if (r.type === 2) return box('rusc', ...common, cstr(r.desc));
  const key = (r as any).keyElementID >>> 0;
  return box('rusc', ...common, u32(key), cstr(r.desc));
}
export type MixingRule =
  | { id: number; type: 3; elementID: number; minVol: number; maxVol: number; desc: string }
  | { id: number; type: 0 | 1 | 2; elementID: number; keyElementID: number; desc: string };
export function rumxBox(r: MixingRule) {
  const common = [full(0, 0), u16(r.id & 0xffff), u8(r.type & 0xff), u32(r.elementID >>> 0)];
  if (r.type === 3) return box('rumx', ...common, i16(Math.round(r.minVol * 256) | 0), i16(Math.round(r.maxVol * 256) | 0), cstr(r.desc));
  const key = (r as any).keyElementID >>> 0;
  return box('rumx', ...common, u32(key), cstr(r.desc));
}
export const rucoBox = (selection: SelectionRule[], mixing: MixingRule[]) =>
  box('ruco', u16(selection.length & 0xffff), u16(mixing.length & 0xffff), ...selection.map(ruscBox), ...mixing.map(rumxBox));

export type ImafSpec = {
  groups?: Group[];
  presets?: Preset[];
  selectionRules?: SelectionRule[];
  mixingRules?: MixingRule[];
  globalPresetSteps?: number;
};
// ---------- low-level readers ----------
const dv = (ab: ArrayBufferLike) => new DataView(ab as ArrayBuffer);
const u8v = (ab: ArrayBufferLike, o: number, n: number) => new Uint8Array(ab as ArrayBuffer, o, n);
const be32 = (b: DataView, o: number) => b.getUint32(o, false);
const be16 = (b: DataView, o: number) => b.getUint16(o, false);
const be64 = (b: DataView, o: number) => {
  const hi = b.getUint32(o, false), lo = b.getUint32(o + 4, false);
  return hi * 2 ** 32 + lo;
};
const f32 = (b: DataView, o: number) => b.getFloat32(o, false);

// Minimal ISO walk helpers (duplicate kept tiny to avoid cross-import cycles)
type Box = { type: string; start: number; size: number; header: number; end: number };
const fourcc = (ab: ArrayBufferLike, o: number) => new TextDecoder("ascii").decode(u8v(ab, o, 4));

function* boxes(ab: ArrayBufferLike, from = 0, to = (ab as ArrayBuffer).byteLength): Generator<Box> {
  const b = dv(ab); let off = from;
  while (off + 8 <= to) {
    let size = be32(b, off); const type = fourcc(ab, off + 4);
    let hdr = 8, end = off + size;
    if (size === 1) { size = Number(be64(b, off + 8)); hdr = 16; end = off + size; }
    if (size === 0) { end = to; size = end - off; }
    if (size < hdr || end > to) break;
    yield { type, start: off, size, header: hdr, end };
    off = end;
  }
}
const kids = (ab: ArrayBufferLike, parent: Box) =>
  Array.from(boxes(ab, parent.start + parent.header, parent.end));
const child = (ab: ArrayBufferLike, parent: Box, typ: string) =>
  kids(ab, parent).find(b => b.type === typ);

// ---------- string helpers for grco/prco authoring symmetry ----------
function readCString(ab: ArrayBufferLike, start: number, limit: number): { text: string; next: number } {
  const view = new Uint8Array(ab as ArrayBuffer, start, limit);
  let i = 0; while (i < view.length && view[i] !== 0x00) i++;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(view.subarray(0, i));
  return { text, next: start + Math.min(i + 1, limit) };
}

function childrenAfter(ab: ArrayBufferLike, parent: Box, skipBytes = 0): Box[] {
  const from = parent.start + parent.header + skipBytes;
  return Array.from(boxes(ab, from, parent.end));
}

// ---------- parse grco ----------
function parseGrco(ab: ArrayBufferLike, grco: Box): Group[] {
  // Layout as authored by grcoBox in your project:
  // u32 count, then for each:
  //   u32 groupID
  //   u8  activationMode
  //   u8  nameLen (or C-string?)  -- In writer you likely used C-strings; we’ll decode C-strings.
  //   f32 referenceVolume
  //   u16 elemCount
  //   u32 elemIDs[elemCount]
  //   char name\0
  //   char description\0
  // The writer in your repo actually used C-strings; adjust if you used fixed-length fields.
  const b = dv(ab);
  // Skip the u16 count field that precedes the first child box.
  let o = grco.start + grco.header;
  const count = be16(b, o);
  // o += 2;

  // Now walk child boxes from 'o' to grco.end
  const grupBoxes = childrenAfter(ab, grco, 2).filter(k => k.type === "grup").slice(0, count);

  const out: Group[] = [];
  for (const g of grupBoxes) {
    let q = g.start + g.header;

    // full(0, flags)
    q += 4;

    const groupID = be32(b, q); q += 4;

    const elemCount = be16(b, q); q += 2;
    const elementIDs: number[] = [];
    for (let i = 0; i < elemCount; i++) { elementIDs.push(be32(b, q)); q += 4; }

    const activationMode = asActivationMode(new Uint8Array(ab as ArrayBuffer, q, 1)[0]); q += 1;

    let activationCount: number | undefined;
    if (activationMode === 2) { activationCount = be16(b, q); q += 2; }

    // referenceVolume is i16 Q8.8 in writer
    const refQ8_8 = new DataView(ab as ArrayBuffer, q, 2).getInt16(0, false); q += 2;
    const referenceVolume = refQ8_8 / 256;

    const { text: name, next: n1 } = readCString(ab, q, g.end - q); q = n1;
    const { text: description } = readCString(ab, q, g.end - q);

    out.push({ groupID, elementIDs, activationMode, activationCount, referenceVolume, name, description });
  }
  return out;
}

// ---------- parse prco ----------
function parsePrco(ab: ArrayBufferLike, prco: Box): { steps: number; presets: Preset[] } {
  // Layout as authored by prcoBox in your project:
  // u16 steps, u16 count, then for each:
  //   u32 presetID
  //   u16 presetType
  //   u16 flags
  //   u16 globalVolumeIndex
  //   u16 elemCount
  //   u32 elemIDs[elemCount]
  //   u16 perElemCount
  //   u16 perElemVolumeIndex[perElemCount]
  //   char name\0
   let o = prco.start + prco.header;

  // prco header in writer: u8 presetCount, u8 steps
  const presetCount = new Uint8Array(ab as ArrayBuffer, o, 1)[0]; o += 1;
  const steps       = new Uint8Array(ab as ArrayBuffer, o, 1)[0]; o += 1;

  // enumerate children AFTER the 2-byte header
  const prstBoxes = childrenAfter(ab, prco, 2)
    .filter(k => k.type === "prst")
    .slice(0, presetCount);

  const b = dv(ab);
  const presets: Preset[] = [];
  for (const pbox of prstBoxes) {
    let q = pbox.start + pbox.header;

    // full(0, flags)
    const flags = new DataView(ab as ArrayBuffer, q, 4).getUint32(0, false) & 0x00FFFFFF;
    q += 4;

    const presetID  = new Uint8Array(ab as ArrayBuffer, q, 1)[0]; q += 1; // u8
    const elemCount = new Uint8Array(ab as ArrayBuffer, q, 1)[0]; q += 1; // u8

    const elementIDs: number[] = [];
    for (let i = 0; i < elemCount; i++) { elementIDs.push(be32(b, q)); q += 4; }

    const presetType        = asPresetType(new Uint8Array(ab as ArrayBuffer, q, 1)[0]); q += 1; // u8 → 0
    const globalVolumeIndex = new Uint8Array(ab as ArrayBuffer, q, 1)[0]; q += 1;               // u8

    const perElementVolumeIndex: number[] = [];
    for (let i = 0; i < elemCount; i++) { perElementVolumeIndex.push(new Uint8Array(ab as ArrayBuffer, q, 1)[0]); q += 1; }

    const { text: name } = readCString(ab, q, pbox.end - q);

    presets.push({ presetID, elementIDs, presetType, globalVolumeIndex, perElementVolumeIndex, name, flags });
  }
  return { steps, presets };
}

// ---------- parse ruco ----------
function parseRuco(ab: ArrayBufferLike, ruco: Box): { selectionRules: SelectionRule[]; mixingRules: MixingRule[] } {
  // Layout as authored by rucoBox in your project:
  // u16 selCount
  //   repeat selCount:
  //     u32 id, u16 type, u32 elementID, u16 min, u16 max, char desc\0
  // u16 mixCount
  //   repeat mixCount:
  //     u32 id, u16 type, u32 elementID, f32 minVol, f32 maxVol, char desc\0
  const b = dv(ab);
  let o = ruco.start + ruco.header;

  const selCount = be16(b, o); o += 2;
  const mixCount = be16(b, o); o += 2;

  // enumerate children AFTER the 4-byte header
  const kidsAll = childrenAfter(ab, ruco, 4);
  const rusc = kidsAll.filter(k => k.type === "rusc").slice(0, selCount);
  const rumx = kidsAll.filter(k => k.type === "rumx").slice(0, mixCount);

  const selectionRules: SelectionRule[] = [];
  for (const s of rusc) {
    let q = s.start + s.header;

    // full(0,0)
    q += 4;

    const id   = be16(b, q); q += 2; // u16 in writer
    const type = asSelectionRuleType(new Uint8Array(ab as ArrayBuffer, q, 1)[0]); q += 1; // u8
    const elementID = be32(b, q); q += 4;

    if (type === 0) {
      const min = be16(b, q); q += 2;
      const max = be16(b, q); q += 2;
      const { text: desc } = readCString(ab, q, s.end - q);
      selectionRules.push({ id, type, elementID, min, max, desc });
    } else if (type === 2) {
      const { text: desc } = readCString(ab, q, s.end - q);
      selectionRules.push({ id, type, elementID, desc });
    } else {
      const keyElementID = be32(b, q); q += 4;
      const { text: desc } = readCString(ab, q, s.end - q);
      selectionRules.push({ id, type, elementID: keyElementID, desc } as any);
    }
  }

  const mixingRules: MixingRule[] = [];
  for (const m of rumx) {
    let q = m.start + m.header;

    // full(0,0)
    q += 4;

    const id   = be16(b, q); q += 2; // u16 in writer
    const type = asMixingRuleType(new Uint8Array(ab as ArrayBuffer, q, 1)[0]); q += 1; // u8
    const elementID = be32(b, q); q += 4;

    if (type === 3) {
      const dv16 = new DataView(ab as ArrayBuffer, q, 4);
      const minVol = dv16.getInt16(0, false) / 256;
      const maxVol = dv16.getInt16(2, false) / 256;
      q += 4;
      const { text: desc } = readCString(ab, q, m.end - q);
      mixingRules.push({ id, type, elementID, minVol, maxVol, desc });
    } else {
      const keyElementID = be32(b, q); q += 4;
      const { text: desc } = readCString(ab, q, m.end - q);
      mixingRules.push({ id, type, elementID: keyElementID, desc } as any);
    }
  }

  return { selectionRules, mixingRules };
}

// ---------- public: extractImafSpecFromIso ----------
export function extractImafSpecFromIso(ab: ArrayBufferLike): ImafSpec | undefined {
  // Find moov and look for grco/prco/ruco as its direct children (matches composer)
  let moov: Box | undefined;
  for (const b of boxes(ab)) if (b.type === "moov") { moov = b; break; }
  if (!moov) return undefined;

  const g = child(ab, moov, "grco");
  const p = child(ab, moov, "prco");
  const r = child(ab, moov, "ruco");

  if (!g && !p && !r) return undefined;

  const spec: ImafSpec = {};
  if (g) spec.groups = parseGrco(ab, g);
  if (p) {
    const { steps, presets } = parsePrco(ab, p);
    spec.globalPresetSteps = steps;
    spec.presets = presets;
  }
  if (r) {
    const { selectionRules, mixingRules } = parseRuco(ab, r);
    spec.selectionRules = selectionRules;
    spec.mixingRules = mixingRules;
  }
  return spec;
}