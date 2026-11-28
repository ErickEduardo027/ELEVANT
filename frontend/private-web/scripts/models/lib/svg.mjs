// The text logos of the liveries (plan M5): public-domain wordmarks from Wikimedia Commons (PD-textlogo or PD-shape),
// made safe to serve from public/models/liveries/logos/ and to draw on a canvas. Pure string work, no dependencies.
//
// What a sanitized logo keeps: its shapes, gradients, clip paths and plain styles. What it loses: the XML prolog and
// doctype (no entities), comments, metadata and editor namespaces (Inkscape, Sodipodi), every script, event
// attribute, foreignObject and embedded image, and every link that leaves the file. It always carries a width and a
// height (from its viewBox when missing), so a browser gives the image a natural size to fit on the fin.

const DROP_ELEMENTS = ['script', 'foreignObject', 'metadata', 'title', 'desc', 'sodipodi:namedview', 'inkscape:perspective',
  'image', 'iframe', 'audio', 'video', 'a'];

const EDITOR_PREFIX = /^(?:sodipodi|inkscape|sketch|serif|i|x|graph|dc|cc|rdf|osb)$/;

function dropElement(svg, name) {
  const escaped = name.replace(':', '\\:');
  // A paired element with its content, then a self-closing one.
  const paired = new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?</${escaped}\\s*>`, 'gi');
  const single = new RegExp(`<${escaped}\\b[^>]*/>`, 'gi');
  return svg.replace(paired, '').replace(single, '');
}

// The attributes of one start tag, rewritten: no event handlers, no editor attributes, no outside links.
function cleanTag(tag) {
  return tag.replace(/\s([A-Za-z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g, (whole, name, quoted) => {
    const lower = name.toLowerCase();
    const value = quoted.slice(1, -1).trim();
    if (lower.startsWith('on')) return '';
    const prefix = lower.includes(':') ? lower.slice(0, lower.indexOf(':')) : null;
    if (prefix === 'xmlns' && EDITOR_PREFIX.test(lower.slice(6))) return '';
    if (prefix !== null && prefix !== 'xmlns' && prefix !== 'xlink' && prefix !== 'xml') return '';
    if ((lower === 'href' || lower === 'xlink:href') && !value.startsWith('#')) return '';
    if (/url\(\s*['"]?(?!#)/i.test(value)) return '';
    if (/javascript:|data:/i.test(value)) return '';
    return whole;
  });
}

/**
 * A logo's SVG made safe: see the module's comment. Throws when what is left is no SVG, or when a style sheet would
 * reach outside the file (@import, or url() of anything but a local fragment).
 */
export function sanitizeLogoSvg(source) {
  if (typeof source !== 'string') throw new TypeError('A logo is SVG text.');
  let svg = source.replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?(?:\[[\s\S]*?\]\s*)?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (const name of DROP_ELEMENTS) svg = dropElement(svg, name);
  // Elements of an editor's namespace.
  svg = svg.replace(/<((?:sodipodi|inkscape|sketch|serif|rdf|cc|dc|i|x|graph):[\w.-]+)\b[^>]*\/>/g, '')
    .replace(/<((?:sodipodi|inkscape|sketch|serif|rdf|cc|dc|i|x|graph):[\w.-]+)\b[^>]*>[\s\S]*?<\/\1\s*>/g, '');
  const styles = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(match => match[1]).join('\n');
  if (/@import|url\(\s*['"]?(?!#)|expression\(|javascript:/i.test(styles)) {
    throw new Error('A logo\'s style sheet reaches outside the file.');
  }
  svg = svg.replace(/<[A-Za-z][\w:.-]*\b[^>]*>/g, tag => cleanTag(tag));
  const start = svg.search(/<svg\b/i);
  const end = svg.lastIndexOf('</svg>');
  if (start < 0 || end < start) throw new Error('A logo must be an SVG document.');
  svg = svg.slice(start, end + '</svg>'.length);
  svg = withSize(svg);
  // Collapse the blank lines the removals left.
  return `${svg.replace(/\r\n?/g, '\n').replace(/\n\s*\n+/g, '\n').trim()}\n`;
}

const number = value => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** The width and height of a logo's root `<svg>` (its attributes, else its viewBox), or null. */
export function svgSize(svg) {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const attribute = name => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1] ?? null;
  const width = attribute('width');
  const height = attribute('height');
  if (width !== null && height !== null && !/%/.test(width + height) && number(width) && number(height)) {
    return { width: number(width), height: number(height) };
  }
  const box = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] };
  return null;
}

// The root with a width and a height in user units (from its viewBox when missing or in percent).
function withSize(svg) {
  const size = svgSize(svg);
  if (size === null) throw new Error('A logo needs a width and a height, or a viewBox.');
  return svg.replace(/<svg\b[^>]*>/i, root => {
    let tag = root.replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    if (!/\sviewBox\s*=/i.test(tag)) tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${size.width} ${size.height}"`);
    return tag.replace(/<svg\b/i, `<svg width="${round(size.width)}" height="${round(size.height)}"`);
  });
}

const round = value => Number(value.toFixed(3));
