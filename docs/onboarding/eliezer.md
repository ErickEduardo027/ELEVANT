# Onboarding Mobile Agent

`frontend/mobile-agent` ya es una app Expo 54/React Native para tablet. Lea
[`AGENTS.md`](../../AGENTS.md),
[`frontend/AGENTS.md`](../../frontend/AGENTS.md), el
[README propio](../../frontend/mobile-agent/README.md), la
[guía API](../api/consumer-guidelines.md) y el
[estado Mobile](../../Vault/05-aplicaciones/mobile-agent.md).

## Primer recorrido

1. Ejecutar `npm ci`, `npm run lint`, `npm run typecheck` y
   `npm run test:api-client-bundle`; abrir el prototipo en emulador/tablet y
   reservar la aceptación de capacidades finales para un build firmado.
2. Recorrer login, vuelos/tareas, operación, checklist, incidencias y sync.
3. Identificar llamadas actuales al backend prototipo y datos locales.
4. Revisar los estados de la outbox actual y distinguir su clave local del
   contrato futuro de device ID registrado + idempotency key del servidor.
5. Revisar permisos de cámara y almacenamiento seguro.

## Reglas

- `EXPO_PUBLIC_*` es visible en APK;
- REST es verdad; SignalR solo avisa;
- servidor valida agente/estación, no IDs enviados por dispositivo;
- reintentos no duplican efectos;
- claves de firma/tokens no se versionan;
- evidencias reales esperan object storage/política.

La entrega inicial prevista es una APK Development firmada por un canal
controlado, pero **todavía no hay CI/CD móvil activo ni APK distribuida por
este repositorio**. Mobile no se aloja en Dokploy. Cuando se integre la API
real, la tablet de Development necesitará acceso HTTPS/Tailscale a esa misma
API. Consulte el [diseño diferido](../../Vault/07-entrega/mobile-apk-ci-cd.md)
antes de planificar firma, EAS o distribución.
