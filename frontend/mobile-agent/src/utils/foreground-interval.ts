import { AppState, type AppStateStatus } from 'react-native';

/**
 * Ejecuta `task` cada `intervalMs` solo mientras la app está en primer plano.
 * Al volver al primer plano lo ejecuta una vez y reanuda el intervalo, así no
 * se consumen red ni batería con la tablet bloqueada. Devuelve la función que
 * detiene el sondeo.
 */
export function startForegroundInterval(task: () => void, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (timer === null) timer = setInterval(task, intervalMs);
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onChange = (state: AppStateStatus) => {
    if (state === 'active') {
      task();
      start();
    } else {
      stop();
    }
  };
  if (AppState.currentState === 'active' || AppState.currentState == null) start();
  const subscription = AppState.addEventListener('change', onChange);
  return () => {
    stop();
    subscription.remove();
  };
}
