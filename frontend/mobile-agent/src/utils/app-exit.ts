import { Alert, BackHandler, Platform } from 'react-native';

export function exitApplication() {
  if (Platform.OS === 'android') {
    Alert.alert('Salir de ELEVANT', '¿Deseas cerrar la aplicación?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: () => BackHandler.exitApp() },
    ]);
    return;
  }
  Alert.alert('Cerrar aplicación', 'En iPhone debes cerrar ELEVANT desde el selector de aplicaciones.');
}
