# Flujo de desarrollo Mobile Agent

`frontend/mobile-agent` ya es una aplicación Expo 54/React Native ejecutable
que consume la misma Elevant API que las webs mediante `@elevant/api-client`;
ya no usa el backend prototipo. Su destino es
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

**Contrato de las escrituras offline:** cada comando offline conserva un device
ID registrado y una idempotency key estable, y el servidor guarda y devuelve el
mismo resultado ante reintentos. Rige para los comandos de la operación (abajo)
y sigue pendiente para cualquier escritura fuera de ellos.
REST recupera el estado canónico tras reconectar; SignalR y el feed de cambios
solo avisan y no son fuente de verdad. Los datos locales son solo una caché:
solo la respuesta de ELEVANT confirma un comando.

Para las escrituras de la operación, ese contrato ya rige desde la fase 3 del
ciclo ([ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)):
el inicio, los servicios, los cargos, el checklist, el chat, los hitos, los
datos del vuelo, las firmas, el walk-around y el charter salen por una sola
cola persistente por cuenta, en orden FIFO por operación, con la instalación
registrada y una clave estable por comando. Para el inicio, los servicios, los
cargos, el checklist, los hitos, los datos del vuelo, las firmas, las marcas del
walk-around y el charter, el recibo del servidor repite el mismo resultado o el
mismo código de rechazo, salvo el `contract_not_in_force` del inicio, que no se
guarda: la misma clave vuelve a evaluar el contrato; el chat se deduplica por la
clave del mensaje (sin recibo: un rechazo se vuelve a evaluar) y la foto del
walk-around viaja sin clave, como un `PUT` por marca en el que los mismos bytes
cuentan como reintento. Las incidencias salen después por su propia cola, y la
entrega a OCC, la corrección y la observación de asistencia conservan su propia
clave reservada fuera de esa cola. El inicio y los servicios llevan
la hora del toque, corregida con el reloj de ELEVANT, y lo que ELEVANT no
confirmó sobrevive a un `401`, un `403` o al cierre de sesión, ligado a su
cuenta. Una API anterior rechaza con `400` la transición de servicio que lleva
`occurredAt` y acepta el inicio con `startedAt`, pero ignora ese campo: el
inicio queda con la hora en que llegó al servidor, no con la del toque. Por eso
la API se despliega antes que la APK. El detalle está en
el [estado de Mobile Agent](../../Vault/05-aplicaciones/mobile-agent.md).

Las claves de firma/tokens futuros deben permanecer fuera de Git. Una
evidencia real no se borrará antes de confirmación persistente ni se
conservará sin política. La foto del walk-around va a un almacenamiento S3
privado; si no está configurado o falla, la API responde `503` y la foto sigue
en la tablet para un reintento automático
([ADR-0032](../adr/0032-aviam-forms-signatures-and-walkaround.md)). El agente
puede descartarla en «Sincronización» para entregar la operación sin ella, y una
foto que la tablet no puede leer, o la de una marca que ELEVANT rechazó, no se
envía y espera allí a que el agente la descarte
([ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).

Para alcanzar la API privada compartida de Development, la tablet necesita
Tailscale y HTTPS: el cliente rechaza otro esquema en
`EXPO_PUBLIC_ELEVANT_API_URL`, salvo el loopback de un build de desarrollo. Una
app pública de tienda usará un dominio Production aprobado, no el tailnet de
Development.
