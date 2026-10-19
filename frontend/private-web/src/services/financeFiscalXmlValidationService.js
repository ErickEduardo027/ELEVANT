import { commercialApi } from './commercialGovernanceApi';

export const MAX_FISCAL_XML_BYTES = 2 * 1024 * 1024;
const maxBase64Characters = Math.ceil(MAX_FISCAL_XML_BYTES / 3) * 4;
const documentTypes = new Set(['E31', 'E32', 'E33', 'E34']);
const invalid = () => Object.assign(new Error('Entrada XML inválida.'), { status: 400 });
const tooLarge = () => Object.assign(new Error('El XML supera 2 MiB.'), { status: 413 });

function validateUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.includes(0)) throw invalid();
  } catch {
    throw invalid();
  }
}

/** In-memory transport only: no storage, XML logging, provider dispatch or schema URL. */
export async function validateFiscalXml(input, { signal } = {}) {
  const { documentType, xmlUtf8, xmlBase64 } = input;
  if (!documentTypes.has(documentType) || (xmlUtf8 != null) === (xmlBase64 != null)) throw invalid();
  let body;
  if (xmlUtf8 != null) {
    if (typeof xmlUtf8 !== 'string' || !xmlUtf8.length) throw invalid();
    if (xmlUtf8.length > MAX_FISCAL_XML_BYTES || new TextEncoder().encode(xmlUtf8).length > MAX_FISCAL_XML_BYTES) throw tooLarge();
    body = { documentType, xmlUtf8 };
  } else {
    if (typeof xmlBase64 !== 'string' || !xmlBase64.length) throw invalid();
    if (xmlBase64.length > maxBase64Characters) throw tooLarge();
    let bytes;
    try { bytes = Uint8Array.from(atob(xmlBase64), character => character.charCodeAt(0)); } catch { throw invalid(); }
    if (bytes.length > MAX_FISCAL_XML_BYTES) throw tooLarge();
    if (!bytes.length) throw invalid();
    validateUtf8(bytes);
    body = { documentType, xmlBase64 };
  }
  return commercialApi('/finance/fiscal-xml/validate', {
    method: 'POST', body: JSON.stringify(body), cache: 'no-store', ...(signal ? { signal } : {}),
  });
}

/** Preserve original local UTF-8 bytes, including BOM/line endings, through base64. */
export async function readFiscalXmlFile(file) {
  if (file.size > MAX_FISCAL_XML_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_FISCAL_XML_BYTES) throw tooLarge();
  if (!bytes.length) throw invalid();
  validateUtf8(bytes);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return { name: file.name, xmlBase64: btoa(chunks.join('')) };
}

export function fiscalXmlError(error) {
  if (error?.status === 401) return 'La sesión expiró. Vuelva a iniciar sesión.';
  if (error?.status === 403) return 'No tiene permiso para validar XML fiscales.';
  if (error?.status === 413) return 'El XML debe ocupar como máximo 2 MiB en UTF-8.';
  if (error?.status === 400) return 'Seleccione E31–E34 y proporcione un XML UTF-8 válido como texto o archivo.';
  if (error?.status === 503) return 'La validación oficial no está disponible. Intente de nuevo.';
  return 'No se pudo validar el XML. Revise la conexión e intente de nuevo.';
}
