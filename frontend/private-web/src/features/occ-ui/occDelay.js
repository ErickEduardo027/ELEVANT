import { toInstantMs } from './occTime';

// The delay of a leg (CN-32): how many minutes its best known time (the actual one, else the estimate) runs past its
// scheduled time. Pure and shared, so the boards of the console and of Monitoreo de vuelos and the inspector say the
// same number. «Cabina oscura» (ADR-0044): a small delay is a plain chip with no hue, and only a delay of 15 minutes or
// more, the industry's on-time limit, asks for attention with the amber triangle.

/** From how many minutes late a leg shows its delay chip. */
export const DELAY_SHOWN_MIN = 5;

/** From how many minutes late the delay asks for attention (the A15/D15 on-time limit). */
export const DELAY_ATTENTION_MIN = 15;

const MINUTE_MS = 60_000;

/**
 * The whole minutes `{ actualAt, estimatedAt, scheduledAt }` runs late: its actual time, else its estimate, minus its
 * scheduled time, rounded to the minute; `null` without a scheduled time or a later one, and for a leg on time or early.
 */
export function delayMinutesOf(times) {
  const scheduled = toInstantMs(times?.scheduledAt);
  const actual = toInstantMs(times?.actualAt);
  const best = Number.isFinite(actual) ? actual : toInstantMs(times?.estimatedAt);
  if (!Number.isFinite(scheduled) || !Number.isFinite(best)) return null;
  const minutes = Math.round((best - scheduled) / MINUTE_MS);
  return minutes > 0 ? minutes : null;
}

/**
 * The chip a delay of `minutes` shows: `null` below DELAY_SHOWN_MIN; otherwise `{ minutes, signal }`, `signal`
 * `attention` from DELAY_ATTENTION_MIN and `null` below it.
 */
export function delayChipOf(minutes) {
  if (!Number.isFinite(minutes) || minutes < DELAY_SHOWN_MIN) return null;
  return Object.freeze({ minutes: Math.round(minutes), signal: minutes >= DELAY_ATTENTION_MIN ? 'attention' : null });
}
