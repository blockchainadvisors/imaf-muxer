//src/iso/meta.ts - meta, hdlr, xml, udta boxes
import { u32, str, cstr, box } from './bytes';

/**
 * Build a generic 'hdlr' box.
 * @param handlerType FourCC (e.g., 'mp7t', 'text').
 * @param name Human-readable name.
 */
export function hdlr_generic(handlerType: string, name: string) {
  return box('hdlr', u32(0), u32(0), str(handlerType), u32(0), u32(0), u32(0), cstr(name));
}

/** Build an 'xml ' leaf box from UTF-8 XML string. */
export const xmlBox = (xml: string) => box('xml ', Buffer.from(xml, 'utf8'));

/**
 * Build a 'meta' container with an internal 'hdlr' and child boxes.
 * @param handlerType FourCC.
 * @param name Handler name.
 * @param children Child boxes (e.g., 'xml ').
 */
export function metaBox(handlerType: string, name: string, ...children: Buffer[]) {
  return box('meta', u32(0), hdlr_generic(handlerType, name), ...children);
}

/** Build a 'udta' user data container. */
export const udta = (...children: Buffer[]) => box('udta', ...children);