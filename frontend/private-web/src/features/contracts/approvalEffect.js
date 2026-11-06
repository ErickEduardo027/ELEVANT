/**
 * What Finance's approval of the prices does, by the status of the contract (1-F). A contract that never
 * activated, or an expired one being renewed, activates later: Contratos confirms the validity, the airline and
 * AVIAM sign and the operating permit is verified. A version of a contract already in force (an amendment, 1-C,
 * or a renewal of an Active or Suspended contract) replaces the version in force from its start as soon as Finance
 * approves it: the previous version ends the day before and nothing activates again; a suspended contract
 * applies the new prices once it is reactivated.
 */

const IN_FORCE = Object.freeze(['Active', 'Suspended']);

/** The contract is already in force (active or suspended): the approved version replaces the current one. */
export const contractInForce = contractStatus => IN_FORCE.includes(contractStatus);

/** «1 de septiembre de 2026» from an ISO date, without a time zone shift. */
export const longDay = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'long', timeZone: 'UTC' })
  .format(new Date(`${value}T12:00:00Z`));

/** Contratos, when it sends a version to Finance: what happens once the prices are approved. */
export function afterFinanceApproval(contractStatus, validFrom) {
  if (contractStatus === 'Active') {
    return `Cuando Finanzas apruebe los precios, esta versión reemplaza a la vigente desde el ${longDay(validFrom)}: el contrato ya está activo, así que los precios nuevos se aplican desde esa fecha sin esperar firmas ni otra activación.`;
  }
  if (contractStatus === 'Suspended') {
    return `Cuando Finanzas apruebe los precios, esta versión reemplaza a la vigente desde el ${longDay(validFrom)}; el contrato sigue suspendido y los precios nuevos se aplican cuando se reactive.`;
  }
  return 'Tras la aprobación de precios, Contratos fija la vigencia, firman la aerolínea y AVIAM y se verifica el permiso de operación; entonces el contrato se activa.';
}

/**
 * Finance, when it approves: the explanation of the approval dialog, the notice once approved and the note on
 * the proposed validity of the version under review.
 */
export function financeApprovalEffect(contractStatus, validFrom) {
  if (contractStatus === 'Active') {
    return {
      explained: `El contrato ya está activo: al aprobar, estos precios rigen desde el ${longDay(validFrom)} y la versión vigente termina el día anterior, sin esperar firmas ni otra activación.`,
      done: `Precios aprobados. Rigen desde el ${longDay(validFrom)}; la versión anterior termina el día anterior.`,
      validity: 'Vigencia propuesta por Contratos, solo lectura: desde esa fecha rigen estos precios, en lugar de los de la versión vigente.',
    };
  }
  if (contractStatus === 'Suspended') {
    return {
      explained: `El contrato está suspendido: al aprobar, estos precios reemplazan a la versión vigente desde el ${longDay(validFrom)} (que termina el día anterior) y se aplican cuando el contrato se reactive.`,
      done: `Precios aprobados. Reemplazan a la versión vigente desde el ${longDay(validFrom)} y se aplican cuando el contrato se reactive.`,
      validity: 'Vigencia propuesta por Contratos, solo lectura: desde esa fecha estos precios reemplazan a los de la versión vigente.',
    };
  }
  return {
    explained: 'Los precios quedarán aprobados. Después Contratos confirma la vigencia y la renovación, firman la aerolínea y AVIAM, y Contratos verifica el permiso de operación de la aerolínea: solo entonces el contrato se activa y el OCC puede planificar sus operaciones.',
    done: 'Precios aprobados. Contratos continúa con la vigencia y las firmas; el contrato se activa después.',
    validity: 'Vigencia propuesta, solo lectura: Contratos la confirma después de tu aprobación, junto con la renovación, antes de las firmas.',
  };
}
