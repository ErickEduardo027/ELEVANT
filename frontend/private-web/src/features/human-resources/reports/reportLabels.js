import { formatBusinessDateTime } from '../../../services/businessDay';

/**
 * Spanish labels of the Gestión Humana report pages (phase 3, block E, 3-N16). The API pages keep their codes, which
 * are contract and filters (`Qualification`, `AirportId`, `Created`…); the screen translates them here, with the same
 * texts the server writes into the PDF and Excel exports. An unknown code is shown as it is.
 */

/** The title of each report, as the export names it. */
export const KIND_LABELS = Object.freeze({
  expirations: 'Vigencias de habilitaciones y permisos',
  'account-movements': 'Movimientos de cuenta',
  'staff-distribution': 'Distribución de turnos',
  'qualification-coverage': 'Cobertura de habilitaciones',
});

/** The class of an expiring document. */
export const DOCUMENT_LABELS = Object.freeze({ Qualification: 'Habilitación', Permit: 'Permiso' });

/** An airport permit by its document type. */
export const PERMIT_LABELS = Object.freeze({
  AirportId: 'Carnet aeroportuario',
  RampDriverLicense: 'Licencia de conducir en rampa',
});

/** An account movement of a ramp agent. */
export const MOVEMENT_LABELS = Object.freeze({
  Created: 'Alta de cuenta',
  Deactivated: 'Cuenta desactivada',
  Reactivated: 'Cuenta reactivada',
});

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

const labelIn = (labels, value) => (Object.hasOwn(labels, value) ? labels[value] : String(value));

/** «2026-10-20» → «20/10/2026», as the exports write the dates. */
export function formatReportDate(value) {
  const match = DATE.exec(typeof value === 'string' ? value : '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? '—');
}

/**
 * What a cell of the report shows: codes in Spanish, dates as `dd/mm/aaaa`, shift times as `hh:mm` and the time of
 * an account movement in the station's local time (AVIAM's stations are in America/Santo_Domingo; the session does
 * not carry each station's zone).
 *
 * @param {string} kind the report (`expirations`, `account-movements`, `staff-distribution`, `qualification-coverage`)
 * @param {string} field the row field of the column
 * @param {Record<string, unknown>} row
 * @param {{ timeZone?: string | null }} [options]
 */
export function formatReportCell(kind, field, row, { timeZone = null } = {}) {
  const value = row?.[field];
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'expirations' && field === 'kind') return labelIn(DOCUMENT_LABELS, value);
  if (kind === 'expirations' && field === 'code') return row.kind === 'Permit' ? labelIn(PERMIT_LABELS, value) : String(value);
  if (kind === 'account-movements' && field === 'kind') return labelIn(MOVEMENT_LABELS, value);
  if (field === 'occurredAt') return formatBusinessDateTime(String(value), { timeZone });
  if (field === 'expiresOn' || field === 'workDate') return formatReportDate(value);
  if (field === 'startsAtLocal' || field === 'endsAtLocal') {
    const match = CLOCK.exec(String(value));
    return match ? `${match[1]}:${match[2]}` : String(value);
  }
  return String(value);
}
