/**
 * Finance reviews a week behind, Sunday to Saturday (ADR-0034): the week that contains the date,
 * moved by whole weeks. Dates are ISO (YYYY-MM-DD) and computed in UTC to avoid DST shifts.
 * «Por facturar» groups an invoice by this week or by the calendar month (4-A).
 */
export function sundayWeek(isoDate, offsetWeeks = 0) {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay() + offsetWeeks * 7);
  const end = new Date(day);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from: day.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
