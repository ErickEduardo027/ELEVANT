import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

/**
 * «Inicio» of Finance (phase 4, block B, 4-A and 4-N02): one read of the indicators the server computes for the
 * station at the business day of Santo Domingo. Each section is null when the account's template does not include
 * the module it summarizes; nothing is derived from preinvoices or from a bounded list in the browser.
 */
export async function getFinanceHomeSnapshot({ stationId }, { signal } = {}) {
  try {
    const home = await createPrivateWebApiClient({ getAccessToken: () => readSession()?.token })
      .getFinanceHome(stationId, { signal, cache: 'no-store' });
    return {
      businessDate: home.businessDate,
      toInvoice: home.toInvoice,
      invoicedThisMonth: home.invoicedThisMonth,
      receivables: home.receivables,
      cardCollectionsThisMonth: home.cardCollectionsThisMonth,
      pendingContractApprovals: home.pendingContractApprovals,
      chartersAwaitingPrepayment: home.chartersAwaitingPrepayment,
    };
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** True when the template includes none of the modules «Inicio» summarizes. */
export const isEmptyFinanceHome = home => Boolean(home) && home.toInvoice === null && home.invoicedThisMonth === null &&
  home.receivables === null && home.cardCollectionsThisMonth === null && home.pendingContractApprovals === null &&
  home.chartersAwaitingPrepayment === null;
