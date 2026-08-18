# Onboarding Mobile Agent

`frontend/mobile-agent` ya es una app Expo 54/React Native para tablet. Lea `AGENTS.md`, `frontend/AGENTS.md`, su README y la guía API.

## Primer recorrido

1. Ejecutar `npm install`, `npm run lint` y abrir en dispositivo representativo.
2. Recorrer login, vuelos/tareas, operación, checklist, incidencias y sync.
3. Identificar llamadas actuales al backend prototipo y datos locales.
4. Revisar device ID + idempotency key y estados de outbox.
5. Revisar permisos de cámara y almacenamiento seguro.

## Reglas

- `EXPO_PUBLIC_*` es visible en APK;
- REST es verdad; SignalR solo avisa;
- servidor valida agente/estación, no IDs enviados por dispositivo;
- reintentos no duplican efectos;
- claves de firma/tokens no se versionan;
- evidencias reales esperan object storage/política.

La entrega inicial será APK Development por canal controlado. Mobile no se aloja en Dokploy; la tablet usa HTTPS/Tailscale hacia la misma API.
