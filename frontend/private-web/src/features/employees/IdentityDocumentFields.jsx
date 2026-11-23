import { useId, useState } from 'react';
import { DOMINICAN_PASSPORT_PREFIX, identityDocumentExample } from '@elevant/api-client';
import { IDENTIFICATION_LABELS } from '../../services/humanResourcesEmployeesService';
import { CEDULA_MASK_LENGTH, formatCedula } from '../../components/inputMasks';
import {
  dominicanPassportDigits, isMaskedDocument, joinDominicanPassport, opensAsForeignPassport,
} from './identityDocumentValue';

const DOCUMENT_KINDS = { CEDULA: 'Cedula', RESIDENCIA: 'Residence', PASAPORTE: 'Passport' };

/**
 * Document type and number of a person. A passport is Dominican by default: the form shows a fixed «RD» and
 * the person types only the 7 digits; «Pasaporte extranjero» removes the prefix. The value is always the
 * full number (RD1234567), so the API and the validation never see the split.
 */
export default function IdentityDocumentFields({
  type, number, types, onChange, fieldClass, typeLabel = 'Documento', numberLabel = 'Número de documento',
  inputRef, required = false, maxLength = 40, invalid, hint, labelClassName = 'text-xs font-semibold',
}) {
  // A Dominican passport only ever holds '' or RD…, so a stored number without RD (an edit) opens as foreign.
  const [foreignChoice, setForeign] = useState(false);
  const inputId = useId();
  const foreign = foreignChoice || opensAsForeignPassport(type, number);
  const passport = type === 'PASAPORTE';
  const dominican = passport && !foreign;

  function changeType(nextType) {
    // Leaving a Dominican passport keeps what was typed, never the «RD» the form wrote.
    const typed = dominican ? dominicanPassportDigits(number) : number;
    const nextDominican = nextType === 'PASAPORTE' && !foreign;
    // A cédula or residence card keeps only the digits typed so far, in its ###-#######-# mask.
    const next = nextDominican ? joinDominicanPassport(typed) : isMaskedDocument(nextType) ? formatCedula(typed) : typed;
    onChange({ identificationType: nextType, identificationNumber: next });
  }

  function changeForeign(checked) {
    setForeign(checked);
    onChange({ identificationNumber: checked ? dominicanPassportDigits(number) : joinDominicanPassport(number) });
  }

  const masked = isMaskedDocument(type);
  const shown = dominican ? dominicanPassportDigits(number) : masked ? formatCedula(number) : number;
  function changeNumber(typed) {
    if (dominican) onChange({ identificationNumber: joinDominicanPassport(typed) });
    else onChange({ identificationNumber: masked ? formatCedula(typed) : typed });
  }

  const input = (
    <input id={inputId} required={required}
      maxLength={dominican ? maxLength - DOMINICAN_PASSPORT_PREFIX.length : masked ? CEDULA_MASK_LENGTH : maxLength}
      ref={inputRef} aria-invalid={invalid || undefined} inputMode={dominican || masked ? 'numeric' : undefined}
      autoComplete={masked ? 'off' : undefined}
      placeholder={dominican ? '1234567' : masked ? '001-1234567-8' : identityDocumentExample(DOCUMENT_KINDS[type] ?? 'Cedula')}
      value={shown}
      onChange={event => changeNumber(event.target.value)}
      className={dominican ? `${fieldClass} !mt-0 min-w-0 !rounded-l-none` : fieldClass} />
  );

  return (
    <>
      <label className={labelClassName}>{typeLabel}
        <select value={type} onChange={event => changeType(event.target.value)} className={fieldClass}>
          {(types ?? Object.keys(IDENTIFICATION_LABELS)).map(key => <option key={key} value={key}>{IDENTIFICATION_LABELS[key] ?? key}</option>)}
        </select></label>
      <div>
        {/* The fixed «RD» stays outside the label, so the field is still named «Número de documento». */}
        <div className={labelClassName}>
          <label htmlFor={inputId} className="block">{numberLabel}</label>
          {dominican ? (
            <span className="mt-1 flex">
              <span aria-hidden="true" title="Pasaporte dominicano"
                className="inline-flex items-center rounded-l-lg border border-r-0 border-black/10 bg-black/5 px-3 text-sm font-semibold dark:border-white/10 dark:bg-white/10">
                {DOMINICAN_PASSPORT_PREFIX}</span>
              {input}
            </span>
          ) : input}
          {hint}
        </div>
        {passport && (
          <label className="mt-1 flex items-center gap-2 text-xs font-normal">
            <input type="checkbox" checked={foreign} onChange={event => changeForeign(event.target.checked)} />
            Pasaporte extranjero
          </label>
        )}
      </div>
    </>
  );
}
