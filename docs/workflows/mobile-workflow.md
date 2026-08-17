# Flujo de desarrollo Mobile Agent

`frontend/mobile-agent` ya es una aplicación Expo 54/React Native ejecutable. Su destino es una tablet Android/iOS: APK Development primero, canales de Play Store/App Store después. No se aloja como web en Dokploy.

1. Definir el flujo online y qué datos estarán disponibles offline.
2. Diseñar autorización agente/estación e idempotencia antes de la outbox.
3. Consumir contratos OpenAPI de la misma Elevant API que usan las webs.
4. Encapsular cámara, almacenamiento seguro, red y sync tras adaptadores.
5. Probar permisos rechazados, falta de espacio, reconexión, duplicados, cierre/reinicio y orden fuera de secuencia.
6. Validar en una tablet representativa, no solo en web/emulador.
7. Generar build Development firmado con application ID, storage y endpoint separados de Production.

Cada comando offline conserva device ID + idempotency key estables. El servidor devuelve el resultado guardado ante reintentos. REST recupera el estado canónico tras reconectar; SignalR no es fuente de verdad.

Las claves de firma/tokens viven fuera de Git. Una evidencia no se borra antes de confirmación persistente ni se conserva sin política; uploads reales quedan deshabilitados hasta implementar object storage.

La tablet de Development accederá por HTTPS/Tailscale a `svc:elevant-dev-api`. Una app pública de tienda usará un dominio Production real, no el tailnet.
