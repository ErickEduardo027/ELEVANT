# Flujo de desarrollo Mobile Agent

`frontend/mobile-agent` ya es una aplicación Expo 54/React Native ejecutable,
pero sus flujos de negocio siguen usando el backend prototipo. Su destino es
una tablet Android/iOS: APK Development firmada primero, canales de tienda
después. No existe hoy un workflow activo de build/distribución APK, perfiles
EAS ni firma aprobada; no se aloja como web en Dokploy. Véanse el
[estado verificable](../../Vault/05-aplicaciones/mobile-agent.md) y el
[diseño diferido de entrega](../../Vault/07-entrega/mobile-apk-ci-cd.md).

1. Definir el flujo online y qué datos estarán disponibles offline.
2. Diseñar autorización agente/estación e idempotencia antes de la outbox.
3. Consumir contratos OpenAPI de la misma Elevant API que usan las webs.
4. Encapsular cámara, almacenamiento seguro, red y sync tras adaptadores.
5. Probar permisos rechazados, falta de espacio, reconexión, duplicados, cierre/reinicio y orden fuera de secuencia.
6. Validar en una tablet representativa, no solo en web/emulador.
7. Generar build Development firmado con application ID, storage y endpoint separados de Production.

**Contrato objetivo, todavía no implementado de extremo a extremo:** cada
comando offline conservará un device ID registrado y una idempotency key
estable; el servidor guardará y devolverá el mismo resultado ante reintentos.
REST recuperará el estado canónico tras reconectar; SignalR solo notificará y
no será fuente de verdad. La outbox actual en AsyncStorage demuestra UX, no
garantías de sincronización segura o exactly-once.

Las claves de firma/tokens futuros deben permanecer fuera de Git. Una
evidencia real no se borrará antes de confirmación persistente ni se
conservará sin política; uploads reales quedan deshabilitados hasta
implementar object storage.

La tablet de Development deberá acceder por HTTPS/Tailscale a la API privada
compartida cuando se integre el cliente real. Una app pública de tienda usará
un dominio Production aprobado, no el tailnet de Development.
