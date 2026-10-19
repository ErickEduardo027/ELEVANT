'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { fiscalXmlError, MAX_FISCAL_XML_BYTES, readFiscalXmlFile, validateFiscalXml } from '../../../services/financeFiscalXmlValidationService';

const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const button = 'rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-white/15';

/** Mount inside DepartmentAccessProvider. This panel has no fiscal dispatch action. */
export default function FiscalXmlValidationPanel() {
  const { access, status } = useDepartmentAccess();
  const id = useId();
  const [documentType, setDocumentType] = useState('E31');
  const [xml, setXml] = useState('');
  const [fileData, setFileData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const fileInput = useRef(null);
  const request = useRef(null);
  const revision = useRef(0);

  useEffect(() => () => { revision.current += 1; request.current?.abort(); }, []);

  function resetResult() { setResult(null); setError(''); }

  function clear() {
    revision.current += 1;
    setXml(''); setFileData(null); resetResult();
    if (fileInput.current) fileInput.current.value = '';
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    resetResult(); setFileData(null); setXml('');
    const current = ++revision.current;
    if (!file) return;
    setReading(true);
    try {
      const local = await readFiscalXmlFile(file);
      if (current === revision.current) setFileData(local);
    } catch (failure) {
      if (current === revision.current) { setError(fiscalXmlError(failure)); event.target.value = ''; }
    } finally {
      if (current === revision.current) setReading(false);
    }
  }

  async function validate(event) {
    event.preventDefault();
    if (busy || reading || !access?.can('finance.fiscal.read')) return;
    const current = ++revision.current;
    const controller = new AbortController();
    request.current = controller;
    resetResult(); setBusy(true);
    try {
      const response = await validateFiscalXml(fileData
        ? { documentType, xmlBase64: fileData.xmlBase64 }
        : { documentType, xmlUtf8: xml }, { signal: controller.signal });
      if (current === revision.current) setResult(response);
    } catch (failure) {
      if (!controller.signal.aborted && current === revision.current) setError(fiscalXmlError(failure));
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }

  if (status === 'loading') return <p role="status">Cargando permisos de validación…</p>;
  if (!access?.can('finance.fiscal.read')) return <p role="alert">No tiene permiso para validar XML fiscales.</p>;

  const disabled = busy || reading;
  return <section aria-labelledby={id + '-title'} className="min-w-0 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-surface-dark-card">
    <h2 id={id + '-title'} className="text-base font-bold">Validación XML oficial · Offline</h2>
    <p className="mt-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
      Revise la estructura de un e-CF con los XSD oficiales. El XML se procesa en memoria y no se archiva.
      La firma criptográfica y la aceptación fiscal quedan sin verificar.
    </p>
    <form onSubmit={validate} className="mt-4 space-y-4">
      <label htmlFor={id + '-type'} className="block text-sm font-semibold">Tipo de e-CF
        <select id={id + '-type'} className={field} value={documentType} disabled={disabled}
          onChange={event => { setDocumentType(event.target.value); resetResult(); }}>
          {['E31', 'E32', 'E33', 'E34'].map(type => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <div>
        <label htmlFor={id + '-file'} className="block text-sm font-semibold">Archivo XML UTF-8</label>
        <input ref={fileInput} id={id + '-file'} type="file" accept=".xml,application/xml,text/xml"
          onChange={chooseFile} disabled={disabled} className={field} aria-describedby={id + '-help'} />
        {fileData && <p className="mt-1 break-all text-sm">{fileData.name}</p>}
      </div>
      <div>
        <label htmlFor={id + '-xml'} className="block text-sm font-semibold">XML UTF-8</label>
        <textarea id={id + '-xml'} value={xml} rows={7} spellCheck={false} maxLength={MAX_FISCAL_XML_BYTES}
          className={field + ' font-mono'} disabled={disabled} aria-describedby={id + '-help'}
          onChange={event => {
            setXml(event.target.value); setFileData(null); resetResult();
            if (fileInput.current) fileInput.current.value = '';
          }} />
        <p id={id + '-help'} className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          Seleccione un archivo o pegue el XML. Máximo 2 MiB en UTF-8. Se envía al API interno al pulsar Validar estructura.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={disabled} aria-busy={busy} className={button + ' bg-accent-600 text-white'}>
          {busy ? 'Validando…' : 'Validar estructura'}
        </button>
        <button type="button" disabled={disabled} onClick={clear} className={button}>Limpiar</button>
      </div>
      {reading && <p role="status" className="text-sm">Leyendo archivo local…</p>}
    </form>
    {result && <div role="status" aria-live="polite" className="mt-5 space-y-3 border-t border-black/10 pt-4 text-sm dark:border-white/10">
      <p className="font-bold">{result.isStructurallyValid ? 'Estructura conforme' : 'Preflight con errores'}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="font-semibold">Esquema</dt><dd>{result.schemaId}</dd><dd>Versión {result.schemaVersion}</dd></div>
        <div><dt className="font-semibold">Validación XSD</dt><dd>{result.schemaValidation === 'Passed' ? 'Cumple XSD' : result.schemaValidation === 'Failed' ? 'Errores XSD' : 'No realizada'}</dd></div>
        <div className="min-w-0 sm:col-span-2"><dt className="font-semibold">SHA-256 del esquema</dt><dd className="break-all font-mono text-xs">{result.schemaSha256}</dd></div>
      </dl>
      <p>{result.signatureElementPresent ? 'Firma: presente, sin verificar' : 'Firma: ausente'}</p>
      <p>Criptografía: no realizada</p><p>Aceptación fiscal: no realizada</p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        La presencia del elemento Signature y un XSD conforme no acreditan validez fiscal.
        Los marcadores de simulación no son firmas válidas.
      </p>
      {result.structuralErrors?.length > 0 && <ul className="space-y-2" aria-label="Errores estructurales">
        {result.structuralErrors.map((item, index) => <li key={index} className="break-words rounded-lg border border-status-danger/25 p-2">
          <span className="font-semibold">{item.code}</span>: {item.message}
          {item.lineNumber > 0 && <span className="block text-xs">Línea {item.lineNumber}, posición {item.linePosition}</span>}
        </li>)}
      </ul>}
    </div>}
  </section>;
}
