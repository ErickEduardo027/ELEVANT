export const OCC_SHIFT_PRESETS = Object.freeze([
  { id: 'morning-0700', label: '07:00–16:00', startsAtLocal: '07:00', endsAtLocal: '16:00' },
  { id: 'morning-0800', label: '08:00–17:00', startsAtLocal: '08:00', endsAtLocal: '17:00' },
  { id: 'day-1100', label: '11:00–20:00', startsAtLocal: '11:00', endsAtLocal: '20:00' },
  { id: 'day-1200', label: '12:00–21:00', startsAtLocal: '12:00', endsAtLocal: '21:00' },
  { id: 'evening-1500', label: '15:00–00:00', startsAtLocal: '15:00', endsAtLocal: '00:00' },
  { id: 'night-2300', label: '23:00–08:00', startsAtLocal: '23:00', endsAtLocal: '08:00' },
].map(item => Object.freeze(item)));

export function getOccShiftPreset(id) {
  return OCC_SHIFT_PRESETS.find(item => item.id === id) ?? null;
}
