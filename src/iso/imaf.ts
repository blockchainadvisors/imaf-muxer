//src/lib/imaf.ts - IMAF boxes (groups, presets, rules) - see IMAF spec v1.0
import { u8,u16,u32,i16,box,cstr,full } from './bytes';

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
  p.elementIDs.forEach((id,i)=>elemIDs.writeUInt32BE(id>>>0,i*4));
  const perElem = Buffer.from(p.perElementVolumeIndex.map(x=> (x|0) & 0xff));
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
  | { id:number; type:0; elementID:number; min:number; max:number; desc:string }
  | { id:number; type:1; elementID:number; keyElementID:number; desc:string }
  | { id:number; type:2; elementID:number; desc:string }
  | { id:number; type:3; elementID:number; keyElementID:number; desc:string };
export function ruscBox(r: SelectionRule) {
  const common = [full(0,0), u16(r.id & 0xffff), u8(r.type & 0xff), u32(r.elementID>>>0)];
  if (r.type===0) return box('rusc', ...common, u16(r.min & 0xffff), u16(r.max & 0xffff), cstr(r.desc));
  if (r.type===2) return box('rusc', ...common, cstr(r.desc));
  const key = (r as any).keyElementID>>>0;
  return box('rusc', ...common, u32(key), cstr(r.desc));
}
export type MixingRule =
  | { id:number; type:3; elementID:number; minVol:number; maxVol:number; desc:string }
  | { id:number; type:0|1|2; elementID:number; keyElementID:number; desc:string };
export function rumxBox(r: MixingRule) {
  const common = [full(0,0), u16(r.id & 0xffff), u8(r.type & 0xff), u32(r.elementID>>>0)];
  if (r.type===3) return box('rumx', ...common, i16(Math.round(r.minVol*256)|0), i16(Math.round(r.maxVol*256)|0), cstr(r.desc));
  const key = (r as any).keyElementID>>>0;
  return box('rumx', ...common, u32(key), cstr(r.desc));
}
export const rucoBox = (selection: SelectionRule[], mixing: MixingRule[]) =>
  box('ruco', u16(selection.length & 0xffff), u16(mixing.length & 0xffff), ...selection.map(ruscBox), ...mixing.map(rumxBox));
