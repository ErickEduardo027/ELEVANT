import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  OPERATION_TABS,
  type OperationTab,
  type OperationTabProgress,
  type OperationTabTone,
} from '../features/assigned-operations/operation-tabs';
import { colors } from '../theme/colors';

const HINT_COLORS: Readonly<Record<OperationTabTone, Readonly<{ fg: string; bg: string }>>> = {
  done: { fg: colors.success, bg: colors.paleGreen },
  pending: { fg: colors.navy, bg: colors.paleBlue },
  warning: { fg: colors.warning, bg: colors.paleAmber },
};

/**
 * CN-22: the operation's tabs, fixed under its card while the screen scrolls. Each tab says its progress («Servicios
 * 3/5», «Cierre ✓»); the selected one is marked by its fill and its underline, not only by its colour.
 */
export const OperationTabBar = memo(function OperationTabBar({ selected, progress, onSelect }: Readonly<{
  selected: OperationTab;
  progress: Readonly<Record<OperationTab, OperationTabProgress>>;
  onSelect: (tab: OperationTab) => void;
}>) {
  return (
    <View style={styles.wrapper}>
      <View accessibilityRole="tablist" style={styles.bar}>
        {OPERATION_TABS.map(tab => {
          const active = tab.id === selected;
          const item = progress[tab.id];
          const tone = item.tone ? HINT_COLORS[item.tone] : null;
          return (
            <Pressable
              accessibilityLabel={item.spoken ? `${tab.label}, ${item.spoken}` : tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={tab.id}
              onPress={() => onSelect(tab.id)}
              style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
              testID={`operation-tab-${tab.id}`}
            >
              <Text numberOfLines={1} style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
              {item.hint && tone ? (
                <Text numberOfLines={1} style={[styles.hint, { color: tone.fg, backgroundColor: active ? colors.white : tone.bg }]}>
                  {item.hint}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // The background covers what scrolls under the fixed bar.
  wrapper: { backgroundColor: colors.background, paddingVertical: 8 },
  bar: {
    flexDirection: 'row',
    padding: 5,
    gap: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 13,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  // The selected tab is filled navy and underlined orange: a shape besides the colour.
  tabActive: { backgroundColor: colors.navy, borderBottomColor: colors.orange },
  label: { color: colors.inkSoft, fontSize: 14, fontWeight: '800' },
  labelActive: { color: colors.white, fontWeight: '900' },
  hint: {
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 99,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  pressed: { opacity: 0.78 },
});
