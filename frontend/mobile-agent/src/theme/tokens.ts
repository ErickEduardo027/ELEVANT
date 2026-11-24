import { Platform } from 'react-native';
import { colors } from './colors';

/**
 * Ramp design tokens (ADR-0031): the tablet is used outdoors, in direct sun and with gloves. Touch
 * targets are never smaller than 56 dp, text never lighter than the AA contrast on white, and
 * every state has a shape or icon besides its colour.
 */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Radii by hierarchy: the screen's blocks are the roundest, what sits inside them less so. */
export const radius = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const touch = { min: 56, large: 72 } as const;

const tabular = ['tabular-nums' as const];

/** The type scale, a step of about 1.2 from the 15 dp body; times always use tabular figures. */
export const type = {
  micro: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.2 },
  caption: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.4 },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, fontWeight: '700' as const },
  label: { fontSize: 15, fontWeight: '800' as const },
  title: { fontSize: 19, fontWeight: '900' as const },
  headline: { fontSize: 23, fontWeight: '900' as const, letterSpacing: -0.2 },
  display: { fontSize: 30, fontWeight: '900' as const, letterSpacing: -0.4 },
  time: { fontSize: 22, fontWeight: '900' as const, fontVariant: tabular },
  timeSmall: { fontSize: 16, fontWeight: '800' as const, fontVariant: tabular },
};

/**
 * Elevation: a hairline outline everywhere and a soft shadow on iOS only. On Android a shadow costs a layer per card in
 * a scrolling list, so only the raised level (the hero, a sheet) uses elevation there.
 */
export const elevation = {
  card: Platform.OS === 'ios'
    ? { shadowColor: '#0A1F44', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }
    : {},
  raised: Platform.OS === 'ios'
    ? { shadowColor: '#0A1F44', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }
    : { elevation: 3 },
};

/** Sync state of a captured value, shown with colour, icon and words. */
export const syncTone = {
  confirmed: { fg: colors.success, bg: colors.paleGreen, icon: 'checkmark-done' as const, label: 'Confirmado' },
  device: { fg: colors.warning, bg: colors.paleOrange, icon: 'phone-portrait-outline' as const, label: 'En el dispositivo' },
  blocked: { fg: colors.danger, bg: colors.paleRed, icon: 'alert-circle' as const, label: 'Rechazado' },
  empty: { fg: colors.muted, bg: colors.white, icon: 'ellipse-outline' as const, label: 'Pendiente' },
};
