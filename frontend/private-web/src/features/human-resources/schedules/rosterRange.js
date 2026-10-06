import { addDays, formatWeekRangeLabel, getWeekStart, toDateKey } from './mappers';

export function getRosterRange(mode, anchor) {
  if (mode === 'week') {
    const start = getWeekStart(anchor);
    return {
      from: toDateKey(start), to: toDateKey(addDays(start, 6)),
      label: formatWeekRangeLabel(start),
    };
  }
  if (mode === 'fortnight') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12);
    const end = addDays(start, 14);
    const format = date => date.toLocaleDateString('es-DO', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    return { from: toDateKey(start), to: toDateKey(end),
      label: `${format(start)} – ${format(end)}` };
  }
  if (mode === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12);
    return { from: toDateKey(start), to: toDateKey(end),
      label: start.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' }) };
  }
  throw new RangeError('Unknown roster range');
}

export function shiftRosterAnchor(mode, anchor, direction) {
  if (mode === 'month')
    return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1, 12);
  if (mode === 'week' || mode === 'fortnight')
    return addDays(anchor, direction * (mode === 'week' ? 7 : 15));
  throw new RangeError('Unknown roster range');
}
