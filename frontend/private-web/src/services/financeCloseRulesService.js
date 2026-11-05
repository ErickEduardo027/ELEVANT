import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

function translate(error) {
  if (error?.name === 'AbortError') return error;
  if (error instanceof TypeError)
    return Object.assign(new Error('Revisa los datos: minutos entre 15 y 720, fecha válida y un nombre de 2 a 120 caracteres.'), { status: 400 });
  if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = status === 403 ? 'Tu acceso no incluye las reglas de cierre de Finanzas.'
    : status === 404 ? 'El festivo ya no existe.'
      : status === 409 ? 'Otra persona cambió esta regla o esa fecha ya tiene otro festivo. Se actualizó la página.'
        : status === 400 ? 'Revisa los datos: minutos entre 15 y 720, fecha válida y un nombre de 2 a 120 caracteres.'
          : 'No se pudieron cargar o guardar las reglas de cierre. Intenta nuevamente.';
  return Object.assign(new Error(message), { status });
}

async function guarded(request) {
  try { return await request(); } catch (error) { throw translate(error); }
}

/** Ground time allowances and holidays the automatic surcharges read (ADR-0034). */
export const loadCloseRules = ({ signal } = {}) => guarded(() => client().getFinanceCloseRules({ signal }));

export const saveGroundTime = (category, allowedMinutes, version) =>
  guarded(() => client().setGroundTimeAllowance(category, { allowedMinutes, version: version ?? null }));

export const addHoliday = (date, name) => guarded(() => client().addFinanceHoliday({ date, name }));

export const removeHoliday = holidayId => guarded(() => client().removeFinanceHoliday(holidayId));
