import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type ModalProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { radius, space, touch, type } from '../theme/tokens';
import { useLayoutClass } from '../utils/layout-class';

/** iOS keeps a modal in portrait unless it lists the orientations; the app follows the device's (fce328ca). */
const ORIENTATIONS: NonNullable<ModalProps['supportedOrientations']> = [
  'portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right',
];

/**
 * Full-screen sheet for something the agent confirms, such as a signature (S2). The header is fixed and names the
 * sheet beside the button that closes it; only the body scrolls; the footer is fixed and holds the actions, so they
 * stay within reach in landscape and below a long body. From the medium width the footer puts its note and its
 * actions in one row; in compact it stacks them. The safe area keeps header and footer clear of the system bars,
 * which a modal draws under on Android (edge to edge).
 */
export function SheetFrame({ eyebrow, title, closeLabel, onClose, scrollEnabled = true, footerNote, actions, children }: {
  /** A short line above the title, such as the role that signs. */
  eyebrow?: string;
  title: string;
  /** What the header's close button says it does, such as «Cerrar sin firmar». */
  closeLabel: string;
  /** Called by the header's close button and by Android's back button. */
  onClose: () => void;
  /** False while a gesture in the body, such as a stroke on a signature pad, owns the touch. */
  scrollEnabled?: boolean;
  /** Shown with the actions, such as the document's fingerprint. */
  footerNote?: ReactNode;
  /** The sheet's buttons, the main one last. */
  actions: ReactNode;
  children: ReactNode;
}) {
  const inRow = useLayoutClass() !== 'compact';
  return (
    <Modal animationType="slide" visible onRequestClose={onClose} supportedOrientations={ORIENTATIONS}>
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safe} accessibilityViewIsModal
        onAccessibilityEscape={onClose}>
        <View style={styles.headerBar}>
          <View style={[styles.column, styles.header]}>
            <View style={styles.heading}>
              {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            </View>
            <Pressable accessibilityLabel={closeLabel} accessibilityRole="button" hitSlop={10} onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
              <Ionicons name="close" size={26} color={colors.navy} />
            </Pressable>
          </View>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={[styles.column, styles.content]}
          scrollEnabled={scrollEnabled} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        <View style={styles.footerBar}>
          <View style={[styles.column, styles.footer, inRow && styles.footerRow]}>
            {footerNote ? <View style={inRow ? styles.noteInRow : undefined}>{footerNote}</View> : null}
            <View style={[styles.actions, inRow && styles.actionsInRow]}>{actions}</View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  // The same width as the operation's manifest, so a landscape tablet does not stretch the lines.
  column: { width: '100%', maxWidth: 960, alignSelf: 'center' },
  headerBar: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.xl, paddingRight: space.md,
    paddingVertical: space.sm },
  heading: { flex: 1, gap: 2 },
  eyebrow: { ...type.caption, color: colors.orange, textTransform: 'uppercase' },
  title: { ...type.title, color: colors.navy },
  close: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  pressed: { opacity: 0.7 },
  body: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xl, gap: space.md },
  footerBar: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border },
  footer: { paddingHorizontal: space.xl, paddingVertical: space.md, gap: space.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.lg },
  noteInRow: { flex: 1 },
  actions: { gap: space.sm },
  actionsInRow: { flexDirection: 'row', gap: space.md },
});
