/** A code that ends in its control's number, as AVIAM's forms number them: ARR-01, PUSH-11. */
const NUMBERED_CODE = /^[A-Z]+-(\d+)$/;

/**
 * The one number a checklist control carries (N12, D-N12), the one the PDF prints (`OperationDocumentPdfRenderer`).
 * A code that ends in a number gives that number without its leading zeros, so the «Reporte de Vuelo» counts 1 to 21
 * across its two sections (ARR-01 … PUSH-21). Any other code, or one whose number is only zeros, gives the control's
 * position within its section, counted from 1, as the bridge form numbers its rows.
 */
export function checklistItemNumber(code: string, index: number): string {
  const number = NUMBERED_CODE.exec(code)?.[1].replace(/^0+/, '');
  return number ? number : String(index + 1);
}
