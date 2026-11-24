import { memo, ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, toneColors, type Tone } from '../theme/colors';
import { elevation, radius, space, touch, type } from '../theme/tokens';

export type IconName = keyof typeof Ionicons.glyphMap;
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost';

/**
 * The tablet's button (ADR-0031): 56 dp tall for gloves, an icon and a verb. `primary` is the one action a block
 * leads to, `accent` the operation's main command (start, hand off), `secondary` the others, `danger` the ones that
 * close or discard, and `ghost` a quiet action inside a card.
 */
export function PrimaryButton({
  title, onPress, icon, disabled, secondary = false, danger = false, variant, compact = false, accessibilityLabel,
  testID,
}: {
  title: string; onPress: () => void; icon?: IconName; disabled?: boolean; secondary?: boolean; danger?: boolean;
  variant?: ButtonVariant;
  /** 48 dp instead of 56 dp, for a secondary action that sits beside a field. */
  compact?: boolean;
  /** What a screen reader says when the title alone does not tell two buttons apart; the title otherwise. */
  accessibilityLabel?: string;
  testID?: string;
}) {
  const kind: ButtonVariant = variant ?? (danger ? 'danger' : secondary ? 'secondary' : 'primary');
  const look = BUTTON_LOOKS[kind];
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, compact && styles.buttonCompact, look.box,
        disabled && styles.disabled, pressed && styles.pressed]}
      testID={testID}
    >
      {icon && <Ionicons name={icon} size={compact ? 18 : 20} color={look.fg} />}
      <Text numberOfLines={2} style={[styles.buttonText, { color: look.fg }]}>{title}</Text>
    </Pressable>
  );
}

const BUTTON_LOOKS: Readonly<Record<ButtonVariant, Readonly<{ box: ViewStyle; fg: string }>>> = {
  primary: { box: { backgroundColor: colors.navy }, fg: colors.white },
  accent: { box: { backgroundColor: colors.orange }, fg: colors.white },
  secondary: { box: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.navy }, fg: colors.navy },
  danger: { box: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.danger }, fg: colors.danger },
  ghost: { box: { backgroundColor: colors.paleBlue }, fg: colors.navy },
};

/** A block of the screen: white on the apron grey, a hairline outline and, on iOS, a soft shadow. */
export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: Tone }) {
  const palette = tone ? toneColors[tone] : null;
  return (
    <View style={[styles.card, palette && { backgroundColor: palette.bg, borderColor: palette.line }, style]}>
      {children}
    </View>
  );
}

export type PillTone = 'blue' | 'green' | 'orange' | 'red' | 'gray' | 'navy';

const PILL_TONES: Readonly<Record<PillTone, Tone | 'navy'>> = {
  blue: 'info', green: 'success', orange: 'warning', red: 'danger', gray: 'neutral', navy: 'navy',
};

/** A state in a few words, with a dot or an icon besides its colour. */
export function StatusPill({ text, tone = 'blue', icon, large = false }: {
  text: string; tone?: PillTone; icon?: IconName;
  /** The hero's pill: one step bigger. */
  large?: boolean;
}) {
  const key = PILL_TONES[tone];
  const palette = key === 'navy'
    ? { fg: colors.white, bg: colors.navy, line: colors.navy }
    : toneColors[key];
  return (
    <View style={[styles.pill, large && styles.pillLarge, { backgroundColor: palette.bg, borderColor: palette.line }]}>
      {icon
        ? <Ionicons name={icon} size={large ? 15 : 13} color={palette.fg} />
        : <View style={[styles.pillDot, { backgroundColor: palette.fg }]} />}
      <Text style={[styles.pillText, large && styles.pillTextLarge, { color: palette.fg }]}>{text}</Text>
    </View>
  );
}

/** A section's heading: its name, an optional line under it and an optional accessory on the right. */
export function SectionHeader({ title, subtitle, right, icon }: {
  title: string; subtitle?: string; right?: ReactNode; icon?: IconName;
}) {
  return (
    <View style={styles.sectionHeader}>
      {icon && <View style={styles.sectionIcon}><Ionicons name={icon} size={18} color={colors.navy} /></View>}
      <View style={styles.sectionCopy}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** A short help line: quiet, under what it explains. */
export function Hint({ children, icon = 'information-circle-outline', tone }: {
  children: ReactNode; icon?: IconName | null; tone?: Tone;
}) {
  const color = tone ? toneColors[tone].fg : colors.muted;
  return (
    <View style={styles.hint}>
      {icon ? <Ionicons name={icon} size={15} color={color} style={styles.hintIcon} /> : null}
      <Text style={[styles.hintText, { color }]}>{children}</Text>
    </View>
  );
}

/** A notice with a title and a message, in its tone; `assertive` for errors. */
export function Notice({ tone, title, message, icon, children }: {
  tone: Tone; title: string; message?: string; icon?: IconName; children?: ReactNode;
}) {
  const palette = toneColors[tone];
  const glyph: IconName = icon ?? (tone === 'success' ? 'checkmark-circle' : tone === 'danger' ? 'alert-circle'
    : tone === 'warning' ? 'warning' : 'information-circle');
  return (
    <View accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.line }]}>
      <Ionicons name={glyph} size={20} color={palette.fg} />
      <View style={styles.noticeCopy}>
        <Text style={[styles.noticeTitle, { color: tone === 'neutral' ? colors.ink : palette.fg }]}>{title}</Text>
        {message ? <Text style={styles.noticeText}>{message}</Text> : null}
        {children}
      </View>
    </View>
  );
}

/** How much of something is done, as a bar and in words beside it. */
export const ProgressBar = memo(function ProgressBar({ done, total, tone = 'info', thin = false }: {
  done: number; total: number; tone?: Tone; thin?: boolean;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  const complete = total > 0 && done >= total;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, thin && styles.trackThin]}
    >
      <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`,
        backgroundColor: complete ? colors.success : toneColors[tone].fg }]} />
    </View>
  );
});

/** A small label: a service, a document, a code. */
export function Tag({ text, icon, tone = 'neutral' }: { text: string; icon?: IconName; tone?: Tone }) {
  const palette = toneColors[tone];
  return (
    <View style={[styles.tag, { backgroundColor: palette.bg, borderColor: palette.line }]}>
      {icon ? <Ionicons name={icon} size={13} color={palette.fg} /> : null}
      <Text numberOfLines={1} style={[styles.tagText, { color: palette.fg }]}>{text}</Text>
    </View>
  );
}

/**
 * A fact of the operation: what it is (small) over its value (strong), with an icon. `onDark` for the navy hero.
 */
export function Fact({ icon, label, value, detail, onDark = false, tone }: {
  icon: IconName; label: string; value: string; detail?: string | null; onDark?: boolean; tone?: Tone;
}) {
  const valueColor = tone ? toneColors[tone].fg : onDark ? colors.white : colors.ink;
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={18} color={onDark ? colors.orangeOnNavy : colors.navy} style={styles.factIcon} />
      <View style={styles.factCopy}>
        <Text style={[styles.factLabel, onDark && styles.factLabelOnDark]}>{label}</Text>
        <Text style={[styles.factValue, { color: valueColor }]}>{value}</Text>
        {detail ? <Text style={[styles.factDetail, onDark && styles.factLabelOnDark]}>{detail}</Text> : null}
      </View>
    </View>
  );
}

/** A square icon button for a toolbar or a header, 56 dp. */
export function IconButton({ icon, accessibilityLabel, onPress, onDark = false, badge }: {
  icon: IconName; accessibilityLabel: string; onPress: () => void; onDark?: boolean; badge?: number;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, onDark && styles.iconButtonOnDark, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={23} color={onDark ? colors.white : colors.navy} />
      {badge ? <View style={styles.iconBadge}><Text style={styles.iconBadgeText}>{badge > 99 ? '99+' : badge}</Text></View>
        : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touch.min,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  buttonCompact: { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.sm },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.78 },
  buttonText: { flexShrink: 1, textAlign: 'center', fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.card,
  },
  pill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillLarge: { paddingVertical: 7, paddingHorizontal: 13 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { flexShrink: 1, textAlign: 'center', fontSize: 12, fontWeight: '800' },
  pillTextLarge: { fontSize: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  sectionIcon: {
    width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { ...type.title, color: colors.ink },
  sectionSubtitle: { ...type.caption, color: colors.muted, marginTop: 2, letterSpacing: 0 },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  hintIcon: { marginTop: 1 },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  notice: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  noticeCopy: { flex: 1, minWidth: 0, gap: 2 },
  noticeTitle: { fontSize: 14, fontWeight: '900' },
  noticeText: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' },
  trackThin: { height: 5, borderRadius: 3 },
  fill: { height: '100%', borderRadius: 4 },
  tag: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  tagText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, minWidth: 0 },
  factIcon: { marginTop: 2 },
  factCopy: { flex: 1, minWidth: 0 },
  factLabel: { ...type.micro, color: colors.muted },
  factLabelOnDark: { color: colors.onNavyMuted },
  factValue: { fontSize: 15, fontWeight: '800', marginTop: 1, fontVariant: ['tabular-nums'] },
  factDetail: { fontSize: 12, fontWeight: '600', color: colors.muted, marginTop: 1 },
  iconButton: {
    width: touch.min, height: touch.min, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border,
  },
  iconButtonOnDark: { backgroundColor: colors.navyRaised, borderColor: colors.navyLine },
  iconBadge: {
    position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.orange,
  },
  iconBadgeText: { color: colors.white, fontSize: 10, fontWeight: '900' },
});
