import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

function translate(error) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof TypeError) return Object.assign(new Error('Revisa el monto y la referencia del prepago.'), { status: 400 });
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = status === 403 ? 'Tu acceso no incluye los charters de Finanzas.'
    : status === 404 ? 'El charter ya no existe o no es de tus estaciones.'
      : status === 409 ? 'Este charter ya tiene otro prepago confirmado. Se actualizó la lista.'
        : status === 400 ? 'Revisa el monto y la referencia del prepago.'
          : 'No se pudieron cargar los charters. Intenta nuevamente.';
  return Object.assign(new Error(message), { status });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translate(error); }
}

/** Charters without contract of Finance's stations (ADR-0033). */
export const listFinanceCharters = ({ signal } = {}) =>
  guarded(async () => (await client().getFinanceCharters({ signal })).charters);

export const confirmCharterPrepayment = (charterId, amount, reference) =>
  guarded(() => client().confirmFinanceCharterPrepayment(charterId, { amount, reference }));
