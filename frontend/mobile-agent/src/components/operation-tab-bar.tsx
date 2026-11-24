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
  done: { fg: colors.success, bg: '#E6F4EC' },
  pending: { fg: colors.navy, bg: colors.paleBlue },
  warning: { fg: colors.warning, bg: colors.paleOrange },
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
                <Text numberOfLines={1} style={[styles.hint, { color: tone.fg, backgroundColor: tone.bg }]}>
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
  wrapper: { backgroundColor: colors.background, paddingVertical: 6 },
  bar: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: 16,
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
    borderRadius: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabActive: { backgroundColor: colors.paleBlue, borderBottomColor: colors.navy },
  label: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  labelActive: { color: colors.navy, fontWeight: '900' },
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
