// src/iso/meta.ts - meta, hdlr, xml, udta boxes
import { u32, str, cstr, box } from './bytes';

/**
 * Build a generic 'hdlr' box.
 * @param handlerType FourCC (e.g., 'mp7t', 'text').
 * @param name Human-readable name.
 */
export function hdlr_generic(handlerType: string, name: string): Uint8Array {
  return box(
    'hdlr',
    u32(0),        // pre_defined
    u32(0),        // reserved
    str(handlerType),
    u32(0), u32(0), u32(0), // reserved[3]
    cstr(name)     // name (null-terminated UTF-8)
  );
}

/**
 * Build an 'xml ' leaf box from UTF-8 XML string.
 * @param xml XML content string
 */
export function xmlBox(xml: string): Uint8Array {
  const xmlBytes = new TextEncoder().encode(xml);
  return box('xml ', xmlBytes);
}

/**
 * Build a 'meta' container with an internal 'hdlr' and child boxes.
 * @param handlerType FourCC (e.g., 'mp7t')
 * @param name Handler name
 * @param children Child boxes (e.g., xmlBox(...))
 */
export function metaBox(handlerType: string, name: string, ...children: Uint8Array[]): Uint8Array {
  return box('meta', u32(0), hdlr_generic(handlerType, name), ...children);
}

/**
 * Build a 'udta' (user data) container.
 * @param children Child boxes
 */
export function udta(...children: Uint8Array[]): Uint8Array {
  return box('udta', ...children);
}