import { colors } from './colors';

/**
 * Ramp design tokens (ADR-0031): the tablet is used outdoors, in direct sun and with gloves. Touch
 * targets are never smaller than 56 dp, text never lighter than the AA contrast on white, and
 * every state has a shape or icon besides its colour.
 */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const touch = { min: 56, large: 72 } as const;

export const type = {
  caption: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.4 },
  body: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 15, fontWeight: '800' as const },
  title: { fontSize: 19, fontWeight: '900' as const },
  time: { fontSize: 22, fontWeight: '900' as const, fontVariant: ['tabular-nums' as const] },
};

/** Sync state of a captured value, shown with colour, icon and words. */
export const syncTone = {
  confirmed: { fg: colors.success, bg: '#E6F4EC', icon: 'checkmark-done' as const, label: 'Confirmado' },
  device: { fg: colors.warning, bg: colors.paleOrange, icon: 'phone-portrait-outline' as const, label: 'En el dispositivo' },
  blocked: { fg: colors.danger, bg: '#FBEAEA', icon: 'alert-circle' as const, label: 'Rechazado' },
  empty: { fg: colors.muted, bg: colors.white, icon: 'ellipse-outline' as const, label: 'Pendiente' },
};
