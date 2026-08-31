import { useMemo, useState } from 'react';
import { getWeekStart, addDays, buildWeekDays, formatWeekRangeLabel, toDateKey } from './mappers';

// Navegación semana anterior/siguiente del calendario de turnos (skill.md
// §"CALENDARIO DE TURNOS"). `direction` se expone para que ShiftCalendar
// anime la transición lateral en el sentido correcto y se limpia solo
// (no se acumula) para no reproducir la animación en renders posteriores
// que no vinieron de un cambio de semana.
export function useWeekNavigation(initialDate = new Date()) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(initialDate));
  const [direction, setDirection] = useState(null);

  const weekDays = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const weekRangeLabel = useMemo(() => formatWeekRangeLabel(weekStart), [weekStart]);
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const isCurrentWeek = weekDays.some(day => day.dateKey === todayKey);

  function goToPreviousWeek() {
    setDirection('previous');
    setWeekStart(current => addDays(current, -7));
  }

  function goToNextWeek() {
    setDirection('next');
    setWeekStart(current => addDays(current, 7));
  }

  function goToToday() {
    setDirection(null);
    setWeekStart(getWeekStart(new Date()));
  }

  return { weekStart, weekDays, weekRangeLabel, direction, isCurrentWeek, goToPreviousWeek, goToNextWeek, goToToday };
}
