# Flujo de desarrollo Mobile Agent

`frontend/mobile-agent` ya es una aplicación Expo 54/React Native ejecutable,
pero sus flujos de negocio siguen usando el backend prototipo. Su destino es
una tablet Android/iOS: APK Development firmada primero, canales de tienda
después. `Mobile Agent CI` valida fuente, tipos y empaquetado Android con Metro;
no existe todavía un workflow de build/distribución APK, perfiles EAS ni firma
aprobada, y la aplicación no se aloja como web en Dokploy. Véanse el
[estado verificable](../../Vault/05-aplicaciones/mobile-agent.md) y el
[diseño diferido de entrega](../../Vault/07-entrega/mobile-apk-ci-cd.md).

1. Definir el flujo online y qué datos estarán disponibles offline.
2. Diseñar autorización agente/estación e idempotencia antes de la outbox.
3. Consumir contratos OpenAPI de la misma Elevant API que usan las webs.
4. Encapsular cámara, almacenamiento seguro, red y sync tras adaptadores.
5. Probar permisos rechazados, falta de espacio, reconexión, duplicados, cierre/reinicio y orden fuera de secuencia.
6. Validar en una tablet representativa, no solo en web/emulador.
7. Generar build Development firmado con application ID, storage y endpoint separados de Production.

## CI de fuente activo

`.github/workflows/mobile-ci.yml` se activa por cambios de Mobile Agent o del
cliente OpenAPI compartido. Instala exactamente el lockfile del subproyecto y
ejecuta lint, typecheck, el smoke Metro del cliente compartido y un export
Android completo. Los orígenes usados durante CI son sintéticos y públicos;
el workflow no contiene credenciales, no crea una APK y no despliega al VPS.

**Contrato objetivo, todavía no implementado de extremo a extremo:** cada
comando offline conservará un device ID registrado y una idempotency key
estable; el servidor guardará y devolverá el mismo resultado ante reintentos.
REST recuperará el estado canónico tras reconectar; SignalR solo notificará y
no será fuente de verdad. La outbox actual en AsyncStorage demuestra UX, no
garantías de sincronización segura o exactly-once.

Para las escrituras de la operación, ese contrato ya rige desde la fase 3 del
ciclo ([ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)):
el inicio, los servicios, los cargos, el checklist, el chat, los hitos, los
datos del vuelo, las firmas, el walk-around y el charter salen por una sola
cola persistente por cuenta, en orden FIFO por operación, con la instalación
registrada y una clave estable por comando. El recibo del servidor repite el
mismo resultado o el mismo código de rechazo. El inicio y los servicios llevan
la hora del toque, corregida con el reloj de ELEVANT, y lo que ELEVANT no
confirmó sobrevive a un `401`, un `403` o al cierre de sesión, ligado a su
cuenta. Una API anterior rechaza con `400` la transición de servicio que lleva
`occurredAt` y acepta el inicio con `startedAt`, pero ignora ese campo: el
inicio queda con la hora en que llegó al servidor, no con la del toque. Por eso
la API se despliega antes que la APK. El detalle está en
el [estado de Mobile Agent](../../Vault/05-aplicaciones/mobile-agent.md).

Las claves de firma/tokens futuros deben permanecer fuera de Git. Una
evidencia real no se borrará antes de confirmación persistente ni se
conservará sin política; uploads reales quedan deshabilitados hasta
implementar object storage.

La tablet de Development deberá acceder por HTTPS/Tailscale a la API privada
compartida cuando se integre el cliente real. Una app pública de tienda usará
un dominio Production aprobado, no el tailnet de Development.
