//src/lib/meta.ts - meta, hdlr, xml, udta boxes
import { u32, str, cstr, box } from './bytes';

export function hdlr_generic(handlerType: string, name: string) {
  return box('hdlr', u32(0), u32(0), str(handlerType), u32(0), u32(0), u32(0), cstr(name));
}
export const xmlBox = (xml: string) => box('xml ', Buffer.from(xml, 'utf8'));
export function metaBox(handlerType: string, name: string, ...children: Buffer[]) {
  return box('meta', u32(0), hdlr_generic(handlerType, name), ...children);
}
export const udta = (...children: Buffer[]) => box('udta', ...children);