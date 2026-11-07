import { inflateSync, constants } from "node:zlib";

/**
 * Reads back what an ELEVANT PDF embeds (hueco 2-D): its fonts and the text it draws, decoded through the
 * ToUnicode maps of its Identity-H fonts. Enough for the reports PDFsharp writes; not a general PDF parser.
 */
export type PdfFonts = { subtypes: string[]; encodings: string[]; fontFileLengths: number[] };

type PdfStream = { dict: string; data: string };

/** Every stream of the file with its dictionary, inflated when it is Flate-encoded. */
function streams(pdf: Buffer): PdfStream[] {
  const text = pdf.toString("latin1");
  const found: PdfStream[] = [];
  let position = 0;
  for (;;) {
    const object = /(\d+) 0 obj\b/g;
    object.lastIndex = position;
    const match = object.exec(text);
    if (!match) break;
    const end = text.indexOf("endobj", match.index);
    const head = /stream\r?\n/g;
    head.lastIndex = match.index;
    const start = head.exec(text);
    if (!start || (end >= 0 && start.index > end)) { position = end < 0 ? text.length : end + 6; continue; }
    const dict = text.slice(match.index, start.index);
    const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const from = start.index + start[0].length;
    let data: Buffer = pdf.subarray(from, from + length);
    // PDFsharp ends its Flate streams without the final flush; a sync flush reads them whole.
    if (/\/FlateDecode/.test(dict)) {
      try { data = inflateSync(data, { finishFlush: constants.Z_SYNC_FLUSH }); } catch { data = Buffer.alloc(0); }
    }
    found.push({ dict, data: data.toString("latin1") });
    position = from + length;
  }
  return found;
}

function unicodeMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const pair of section[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))
      map.set(parseInt(pair[1]!, 16), Buffer.from(pair[2]!, "hex").swap16().toString("utf16le"));
  for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const range of section[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const [low, high, first] = [parseInt(range[1]!, 16), parseInt(range[2]!, 16), parseInt(range[3]!, 16)];
      for (let code = low; code <= high; code += 1) map.set(code, String.fromCodePoint(first + code - low));
    }
  return map;
}

/** The font dictionaries of the file: their subtype, encoding and the decoded length of each embedded font file. */
export function pdfFonts(pdf: Buffer): PdfFonts {
  const text = pdf.toString("latin1");
  return {
    subtypes: [...text.matchAll(/\/Type\s*\/Font\b[^>]*?\/Subtype\s*\/(\w+)/g)].map(match => match[1]!),
    encodings: [...text.matchAll(/\/Encoding\s*\/([\w-]+)/g)].map(match => match[1]!),
    fontFileLengths: [...text.matchAll(/\/Length1\s+(\d+)/g)].map(match => Number(match[1])),
  };
}

/** The strings the pages draw, one per text operator, decoded by the ToUnicode maps of the file. */
export function pdfText(pdf: Buffer): string {
  const all = streams(pdf);
  const maps = all.filter(item => /begincmap/.test(item.data)).map(item => unicodeMap(item.data));
  const content = all.filter(item => /\bT[Jj]\b/.test(item.data)).map(item => item.data).join("\n");
  return [...content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj|\[([^\]]*)\]\s*TJ/g)].map(match => {
    const hex = (match[1] ?? [...(match[2] ?? "").matchAll(/<([0-9A-Fa-f\s]+)>/g)].map(item => item[1]).join(""))
      .replace(/\s+/g, "");
    let decoded = "";
    for (let index = 0; index + 4 <= hex.length; index += 4) {
      const code = parseInt(hex.slice(index, index + 4), 16);
      decoded += maps.map(map => map.get(code)).find(value => value !== undefined) ?? "?";
    }
    return decoded;
  }).join("\n");
}
