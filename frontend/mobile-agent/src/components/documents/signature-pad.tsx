import { SIGNATURE_MAX_POINTS, SIGNATURE_MAX_STROKES, SIGNATURE_PAD_ASPECT } from '@elevant/api-client';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../theme/colors';
import { radius, space, type } from '../../theme/tokens';

export type Strokes = readonly (readonly number[])[];

/**
 * Drawn signature (ADR-0032). Points are kept normalized (0–1) on a 3:1 pad, so the PDF draws the
 * same strokes at any size. A finger or a stylus; the parent scroll stops while drawing.
 */
export function SignaturePad({ value, onChange, onDrawing }: {
  value: Strokes; onChange: (strokes: Strokes) => void; onDrawing?: (drawing: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  const height = width / SIGNATURE_PAD_ASPECT;
  const current = useRef<number[]>([]);
  const [live, setLive] = useState<number[]>([]);
  const latest = useRef({ value, onChange, onDrawing, width, height });
  latest.current = { value, onChange, onDrawing, width, height };

  const responder = useMemo(() => {
    const point = (x: number, y: number) => {
      const { width: w, height: h } = latest.current;
      return [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))];
    };
    const total = () => latest.current.value.reduce((sum, stroke) => sum + stroke.length / 2, 0) + current.current.length / 2;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => {
        latest.current.onDrawing?.(true);
        current.current = point(event.nativeEvent.locationX, event.nativeEvent.locationY);
        setLive(current.current);
      },
      onPanResponderMove: event => {
        if (total() >= SIGNATURE_MAX_POINTS) return;
        current.current = [...current.current, ...point(event.nativeEvent.locationX, event.nativeEvent.locationY)];
        setLive(current.current);
      },
      onPanResponderRelease: () => {
        latest.current.onDrawing?.(false);
        const stroke = current.current.length >= 4 ? current.current : [...current.current, ...current.current];
        current.current = [];
        setLive([]);
        if (latest.current.value.length < SIGNATURE_MAX_STROKES) latest.current.onChange([...latest.current.value, stroke]);
      },
    });
  }, []);

  const path = (stroke: readonly number[]) => {
    let d = '';
    for (let index = 0; index < stroke.length; index += 2)
      d += `${index === 0 ? 'M' : 'L'}${(stroke[index]! * width).toFixed(1)} ${(stroke[index + 1]! * height).toFixed(1)} `;
    return d;
  };

  return (
    <View style={styles.wrap}>
      <View accessibilityLabel="Área de firma" style={[styles.pad, { height: height || 160 }]}
        onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Path d={`M${width * 0.06} ${height * 0.78} L${width * 0.94} ${height * 0.78}`} stroke={colors.border} strokeWidth={2} />
            {[...value, live].filter(stroke => stroke.length >= 2).map((stroke, index) => (
              <Path key={index} d={path(stroke)} stroke={colors.navy} strokeWidth={3} fill="none" strokeLinecap="round"
                strokeLinejoin="round" />
            ))}
          </Svg>
        )}
        {value.length === 0 && live.length === 0 && (
          <Text pointerEvents="none" style={styles.placeholder}>Firme aquí con el dedo</Text>
        )}
      </View>
      <Pressable accessibilityRole="button" onPress={() => onChange([])} disabled={value.length === 0}
        style={({ pressed }) => [styles.clear, value.length === 0 && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.clearText}>Borrar firma</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  pad: { borderWidth: 2, borderColor: colors.navy, borderStyle: 'dashed', borderRadius: radius.md, backgroundColor: colors.white,
    overflow: 'hidden', justifyContent: 'center' },
  placeholder: { ...type.body, color: colors.muted, textAlign: 'center', position: 'absolute', left: 0, right: 0, top: '42%' },
  clear: { alignSelf: 'flex-end', paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, minHeight: 44, justifyContent: 'center' },
  clearText: { ...type.label, color: colors.navy },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
