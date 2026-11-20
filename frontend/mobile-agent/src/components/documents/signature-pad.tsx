import { SIGNATURE_MAX_POINTS, SIGNATURE_MAX_STROKES, SIGNATURE_PAD_ASPECT } from '@elevant/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../theme/colors';
import { radius, space, type } from '../../theme/tokens';

export type Strokes = readonly (readonly number[])[];

/**
 * Drawn signature (ADR-0032). Points are kept normalized (0–1) on a 3:1 pad, so the PDF draws the
 * same strokes at any size. A finger or a stylus; the parent scroll stops while drawing.
 *
 * S2: only a lifted finger keeps a stroke. When the gesture is taken away, for example by the sheet's
 * scroll when a swipe starts on the pad, the stroke in progress is dropped and the scroll comes back;
 * «Borrar firma» and a pad that leaves the screen mid-stroke do the same. The pad is at most 720 dp wide.
 */
export function SignaturePad({ value, onChange, onDrawing }: {
  value: Strokes; onChange: (strokes: Strokes) => void; onDrawing?: (drawing: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  const height = width / SIGNATURE_PAD_ASPECT;
  const current = useRef<number[]>([]);
  /** True from the moment the pad takes the touch until its stroke is kept or dropped. */
  const drawing = useRef(false);
  const [live, setLive] = useState<number[]>([]);
  const latest = useRef({ value, onChange, onDrawing, width, height });
  latest.current = { value, onChange, onDrawing, width, height };

  const { responder, dropStroke } = useMemo(() => {
    const point = (x: number, y: number) => {
      const { width: w, height: h } = latest.current;
      return [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))];
    };
    const total = () => latest.current.value.reduce((sum, stroke) => sum + stroke.length / 2, 0) + current.current.length / 2;
    /** Ends the stroke in progress, if any, and gives the parent its scroll back. Returns the stroke's points. */
    const endStroke = () => {
      if (!drawing.current) return null;
      drawing.current = false;
      const stroke = current.current;
      current.current = [];
      setLive([]);
      latest.current.onDrawing?.(false);
      return stroke;
    };
    return {
      dropStroke: () => { endStroke(); },
      responder: PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: event => {
          drawing.current = true;
          latest.current.onDrawing?.(true);
          current.current = point(event.nativeEvent.locationX, event.nativeEvent.locationY);
          setLive(current.current);
        },
        onPanResponderMove: event => {
          if (!drawing.current || total() >= SIGNATURE_MAX_POINTS) return;
          current.current = [...current.current, ...point(event.nativeEvent.locationX, event.nativeEvent.locationY)];
          setLive(current.current);
        },
        onPanResponderRelease: () => {
          const points = endStroke();
          if (!points) return;
          const stroke = points.length >= 4 ? points : [...points, ...points];
          if (latest.current.value.length < SIGNATURE_MAX_STROKES) latest.current.onChange([...latest.current.value, stroke]);
        },
        // S2: Android's scroll view took the gesture (a swipe that began on the pad), or the system cancelled it. The
        // pad never got the finger lifted, so the stroke is dropped; the strokes already kept stay.
        onPanResponderTerminate: () => { endStroke(); },
      }),
    };
  }, []);

  // A pad that leaves the screen mid-stroke never keeps its parent from scrolling.
  useEffect(() => () => dropStroke(), [dropStroke]);

  const empty = value.length === 0 && live.length === 0;
  const clear = () => {
    dropStroke();
    onChange([]);
  };

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
        {empty && (
          <Text pointerEvents="none" style={styles.placeholder}>Firme aquí con el dedo</Text>
        )}
      </View>
      <Pressable accessibilityRole="button" onPress={clear} disabled={empty}
        style={({ pressed }) => [styles.clear, empty && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.clearText}>Borrar firma</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // S2: a landscape tablet would otherwise draw a pad taller than the space between the sheet's header and footer.
  wrap: { gap: space.sm, width: '100%', maxWidth: 720, alignSelf: 'center' },
  pad: { borderWidth: 2, borderColor: colors.navy, borderStyle: 'dashed', borderRadius: radius.md, backgroundColor: colors.white,
    overflow: 'hidden', justifyContent: 'center' },
  placeholder: { ...type.body, color: colors.muted, textAlign: 'center', position: 'absolute', left: 0, right: 0, top: '42%' },
  clear: { alignSelf: 'flex-end', paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, minHeight: 44, justifyContent: 'center' },
  clearText: { ...type.label, color: colors.navy },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
