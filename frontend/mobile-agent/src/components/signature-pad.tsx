/* eslint-disable react-hooks/immutability -- PanResponder requires mutable stroke state between native gesture callbacks. */
import { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { PrimaryButton } from './ui';
import { colors } from '../theme/colors';

export function SignaturePad({
  paths,
  onChange,
  disabled = false,
}: {
  paths: readonly string[];
  onChange: (paths: readonly string[]) => void;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState('');
  const responder = useMemo(() => {
    let activePath = '';
    return PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: event => {
      const { locationX, locationY } = event.nativeEvent;
      const path = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
      activePath = path;
      setCurrent(path);
    },
    onPanResponderMove: event => {
      const { locationX, locationY } = event.nativeEvent;
      const path = `${activePath} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
      activePath = path;
      setCurrent(path);
    },
    onPanResponderRelease: () => {
      if (activePath.includes(' L ')) onChange([...paths, activePath]);
      activePath = '';
      setCurrent('');
    },
    onPanResponderTerminate: () => {
      activePath = '';
      setCurrent('');
    },
    });
  }, [disabled, onChange, paths]);

  return <View>
    <View
      accessibilityLabel="Área para firma manuscrita"
      style={[styles.canvas, disabled && styles.disabled]}
      {...responder.panHandlers}
    >
      <Svg height="100%" width="100%">
        {paths.map((path, index) => <Path d={path} fill="none" key={`${index}:${path}`} stroke={colors.navy} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />)}
        {current ? <Path d={current} fill="none" stroke={colors.navy} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} /> : null}
      </Svg>
      {paths.length === 0 && !current && <Text pointerEvents="none" style={styles.placeholder}>Firma aquí con el dedo</Text>}
    </View>
    <PrimaryButton title="LIMPIAR FIRMA" icon="trash-outline" onPress={() => onChange([])} disabled={disabled || paths.length === 0} secondary />
  </View>;
}

const styles = StyleSheet.create({
  canvas: { height: 190, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.white, overflow: 'hidden', marginBottom: 10 },
  disabled: { opacity: 0.5 },
  placeholder: { position: 'absolute', alignSelf: 'center', top: 80, color: colors.muted, fontSize: 13 },
});
