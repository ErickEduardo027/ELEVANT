/**
 * The ramp palette (ADR-0031): AVIAM's navy and orange on a cool apron grey. Every text colour keeps AA contrast on
 * white and on `background`; status colours come in pairs (foreground on its tint) and always go with an icon or a
 * word, never alone. The first keys are the ones every screen already uses; the rest are the semantic ones.
 */
export const colors = {
  // Brand
  navy: '#082B67',
  navyDeep: '#051D47',
  navyRaised: '#123C82',
  navyLine: '#2A4E8C',
  blue: '#0B4A9B',
  orange: '#FF5A00',
  orangeOnNavy: '#FFB58A',

  // Text
  ink: '#0E1A33',
  inkSoft: '#2E3B55',
  muted: '#5A6679',
  onNavy: '#FFFFFF',
  onNavyMuted: '#B9C8E2',

  // Surfaces and lines
  background: '#EEF2F7',
  white: '#FFFFFF',
  surfaceSunken: '#F5F7FA',
  border: '#D6DEE9',
  borderStrong: '#B7C4D6',
  divider: '#E5EAF1',

  // Status (foreground on white; each has its tint below)
  success: '#0E7A43',
  warning: '#8F4A00',
  danger: '#B42318',
  info: '#0B4A9B',

  // Tints and their outlines
  paleBlue: '#E8F0FB',
  paleOrange: '#FFF0E6',
  paleGreen: '#E4F4EA',
  paleRed: '#FDECEA',
  paleAmber: '#FFF6E0',
  blueLine: '#BFD2EE',
  greenLine: '#A9D9BC',
  amberLine: '#EFC46B',
  redLine: '#F0B4AE',
  orangeLine: '#FFC9A8',
};

/** One status as the ramp reads it. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

/** Each tone's text and icon colour, its tint and its outline. */
export const toneColors: Readonly<Record<Tone, Readonly<{ fg: string; bg: string; line: string }>>> = {
  neutral: { fg: colors.inkSoft, bg: colors.surfaceSunken, line: colors.border },
  info: { fg: colors.info, bg: colors.paleBlue, line: colors.blueLine },
  success: { fg: colors.success, bg: colors.paleGreen, line: colors.greenLine },
  warning: { fg: colors.warning, bg: colors.paleAmber, line: colors.amberLine },
  danger: { fg: colors.danger, bg: colors.paleRed, line: colors.redLine },
  brand: { fg: '#A93C00', bg: colors.paleOrange, line: colors.orangeLine },
};
