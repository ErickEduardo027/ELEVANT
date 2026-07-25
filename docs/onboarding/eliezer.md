# Onboarding de Eliezer — Mobile Agent

Mobile Agent es un esqueleto para una futura aplicación Expo instalada en tablet. La prioridad técnica es mantener seguridad y comportamiento comprensible con conectividad intermitente.

## Primer recorrido

1. Leer `frontend/mobile-agent/README.md` y la guía de consumidores API.
2. Revisar separación entre REST como fuente de verdad y SignalR como aviso.
3. Modelar en papel estados de outbox, reintentos e idempotencia.
4. Identificar qué variables `EXPO_PUBLIC_*` son visibles dentro de la APK.
5. Revisar permisos de cámara, evidencia y almacenamiento seguro.

## Al iniciar Expo

- fijar versión de Node, pnpm, Expo y Expo Router;
- probar desde una tablet y una red representativas;
- encapsular capacidades nativas para poder simularlas;
- separar identificador, endpoint, firma y almacenamiento de Development/Production;
- no guardar tokens en configuración pública ni logs.

## Verificación

Poder demostrar una operación pendiente que sobrevive al reinicio, una reconexión sin duplicar efectos y un permiso de cámara rechazado sin bloquear el resto de la aplicación.
