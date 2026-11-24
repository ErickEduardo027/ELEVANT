import { formatBusinessDate } from '../../../services/businessDay';

/**
 * Wording of a contract version shared by the agreements list, the contract detail and its lifecycle panel (N33).
 */

/**
 * A version's validity. A list keeps it neutral (`style: 'short'`, the default): «01/09/2026 — 31/08/2027», or
 * «01/09/2026 — Sin vencimiento» for a validity with no end. Inside a sentence (`style: 'long'`) it reads
 * «del 3 de noviembre de 2026 al 2 de noviembre de 2027», or «desde el 3 de noviembre de 2026, sin vencimiento»,
 * never «al Sin vencimiento». The sentence form starts in lower case; a line that opens with it capitalizes it.
 *
 * @param {string} validFrom `yyyy-mm-dd`
 * @param {string | null | undefined} validTo `yyyy-mm-dd`, or nothing for a validity with no end
 * @param {{ style?: 'short' | 'long' }} [options]
 */
export function validityRange(validFrom, validTo, { style = 'short' } = {}) {
  if (style !== 'long') return `${formatBusinessDate(validFrom)} — ${validTo ? formatBusinessDate(validTo) : 'Sin vencimiento'}`;
  const from = formatBusinessDate(validFrom, { style: 'long' });
  return validTo ? `del ${from} al ${formatBusinessDate(validTo, { style: 'long' })}` : `desde el ${from}, sin vencimiento`;
}

/**
 * The airline's designator as shown. SQL pads a two-letter IATA code to the width of the ICAO column («WN »), and the
 * signed content keeps that stored value, so only the screen trims it. A missing code is an empty string.
 *
 * @param {string | null | undefined} code
 */
export const airlineCodeLabel = code => (typeof code === 'string' ? code.trim() : '');

/**
 * A count with its noun, in the singular only for one: «1 versión publicada», «2 versiones publicadas», «0 tarifas
 * pactadas».
 *
 * @param {number} count
 * @param {string} one
 * @param {string} many
 */
export const countLabel = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * CN-13: a published version in the agreements list. Finance's approval fixes the prices, not the contract: a version
 * of a contract that never activated (status «Draft», no `signedOn`) still waits for the signatures and the airline's
 * operating permit, so it never reads «Aprobada» alone. The list has no signatures of its own; the detail names them.
 *
 * @param {{ status: string }} version
 * @param {{ status?: string, signedOn?: string | null }} [contract]
 */
export function publishedVersionLabel(version, contract) {
  if (version.status === 'Superseded') return 'Reemplazada';
  if (version.status === 'Approved' && contract?.status === 'Draft' && !contract?.signedOn)
    return 'Precios aprobados · pendiente de firmas y permiso';
  return 'Aprobada';
}
