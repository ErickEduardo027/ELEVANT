import { COVERAGE_STATUS_META, getCoverageStatusKey } from './statusMeta';

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

// Claves de fecha en formato YYYY-MM-DD sobre componentes de calendario
// LOCALES (no UTC/ISO) — evita el corrimiento de día que produciría
// `toISOString()` cerca de medianoche en zonas horarias negativas como
// América/Santo_Domingo.
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

// Semana de lunes a domingo (skill.md §"CALENDARIO DE TURNOS": "columnas =
// días"). `date` puede ser cualquier día de la semana deseada.
export function getWeekStart(date) {
  const start = new Date(date);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function buildWeekDays(weekStart, today = new Date()) {
  const todayKey = toDateKey(today);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const dateKey = toDateKey(date);
    return {
      dateKey,
      date,
      weekdayLabel: WEEKDAY_LABELS[date.getDay()],
      dayLabel: date.getDate(),
      monthLabel: date.toLocaleDateString('es-DO', { month: 'short' }),
      isToday: dateKey === todayKey,
    };
  });
}

export function formatWeekRangeLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const startLabel = weekStart.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' });
  const endLabel = weekEnd.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

export function formatDate(dateKey) {
  if (!dateKey) return '—';
  return parseDateKey(dateKey).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Índice agente+fecha -> turno, usado tanto para pintar la grilla como para
// detectar solapamientos al validar una asignación nueva.
export function indexShiftsByAgentAndDate(shifts) {
  const index = new Map();
  for (const shift of shifts) {
    index.set(`${shift.agentId}|${shift.date}`, shift);
  }
  return index;
}

export function indexShiftsByDate(shifts) {
  const index = new Map();
  for (const shift of shifts) {
    const list = index.get(shift.date) ?? [];
    list.push(shift);
    index.set(shift.date, list);
  }
  return index;
}

export function filterShiftsByWeek(shifts, weekDays) {
  const weekDateKeys = new Set(weekDays.map(day => day.dateKey));
  return shifts.filter(shift => weekDateKeys.has(shift.date));
}

// KPIs del resumen superior del calendario (skill.md §"CALENDARIO DE
// TURNOS"): agentes distintos programados y agentes en turno de madrugada
// se acumulan en los 7 días visibles, pero "alertas de cobertura" se mide
// sobre un solo día de referencia (hoy si cae en la semana visible; si no,
// el primer día) — sumar los 7 días infla el número a una cifra que ya no
// se lee como una alerta accionable, y desalinearía el KPI de la vista
// "Cobertura por posición", que también parte de un solo día.
export function deriveScheduleKpis(weekShifts, weekDays, coverageRequirements, positionsById) {
  const scheduledAgentsCount = new Set(weekShifts.map(shift => shift.agentId)).size;
  const nightShiftAgentsCount = new Set(weekShifts.filter(shift => shift.block === 'night').map(shift => shift.agentId)).size;

  const referenceDay = weekDays.find(day => day.isToday) ?? weekDays[0];
  const shiftsByDate = indexShiftsByDate(weekShifts);
  const referenceEntries = buildCoverageForDate(shiftsByDate.get(referenceDay?.dateKey) ?? [], coverageRequirements, positionsById);
  const coverageAlertsCount = referenceEntries.filter(entry => entry.status !== 'complete').length;

  return { scheduledAgentsCount, nightShiftAgentsCount, coverageAlertsCount };
}

// Cobertura de un único día: una entrada por requisito (posición/terminal/
// bloque), con cuántos agentes hay asignados y el estado resultante
// (skill.md §"COBERTURA POR POSICIÓN").
export function buildCoverageForDate(shiftsForDate, coverageRequirements, positionsById) {
  return coverageRequirements.map(requirement => {
    const assigned = shiftsForDate.filter(
      shift => shift.terminal === requirement.terminal && shift.block === requirement.block && shift.positionId === requirement.positionId
    );
    const statusKey = getCoverageStatusKey(assigned.length, requirement.requiredCount);
    const statusMeta = COVERAGE_STATUS_META[statusKey];

    return {
      key: `${requirement.terminal}-${requirement.block}-${requirement.positionId}`,
      terminal: requirement.terminal,
      block: requirement.block,
      positionId: requirement.positionId,
      positionName: positionsById.get(requirement.positionId)?.name ?? requirement.positionId,
      requiredCount: requirement.requiredCount,
      assignedCount: assigned.length,
      assignedAgentNames: assigned.map(shift => shift.agentName),
      status: statusKey,
      statusLabel: statusMeta.label,
      statusTone: statusMeta.tone,
    };
  });
}

// Agrupa las entradas de cobertura de un día por bloque de turno y, dentro
// de cada bloque, por terminal — el orden de lectura que pide el skill
// ("vista por franjas horarias... cobertura por Terminal A/B"). También
// marca `combinedRisk` cuando, sumando ambos terminales, la cobertura total
// del bloque cae por debajo de la mitad de lo requerido (skill.md: "franjas
// donde pocos agentes cubren ambas terminales").
export function groupCoverageByBlock(entries, shiftBlocks) {
  return shiftBlocks.map(block => {
    const blockEntries = entries.filter(entry => entry.block === block.id);
    const byTerminal = {
      A: blockEntries.filter(entry => entry.terminal === 'A'),
      B: blockEntries.filter(entry => entry.terminal === 'B'),
    };

    const totalRequired = blockEntries.reduce((sum, entry) => sum + entry.requiredCount, 0);
    const totalAssigned = blockEntries.reduce((sum, entry) => sum + Math.min(entry.assignedCount, entry.requiredCount), 0);
    const combinedRisk = totalRequired > 0 && totalAssigned / totalRequired < 0.5;
    const worstStatus = blockEntries.some(entry => entry.status === 'critical')
      ? 'critical'
      : blockEntries.some(entry => entry.status === 'at_risk')
        ? 'at_risk'
        : 'complete';

    return { block, byTerminal, combinedRisk, worstStatus };
  });
}
