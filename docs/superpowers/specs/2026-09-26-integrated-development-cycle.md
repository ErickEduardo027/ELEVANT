# Ciclo integral Development de ELEVANT

## Resultado esperado

Una aerolínea solicita afiliación en Public Web, Contratos aprueba su acceso y
un contrato versionado, OCC registra una escala manual, programa los servicios
contratados y asigna personal habilitado, Mobile Agent ejecuta y entrega, OCC
revisa, Finanzas concilia y emite una factura de prueba, y finalmente registra
un pago completo de prueba para que la aerolínea descargue su recibo. Public
Web, AVIAM Web y Mobile Agent consumen una sola API versionada y la misma base
lógica Development. El diseño visual de los prototipos se conserva, pero sus
datos locales no son contratos ni estado de negocio.

## Límites acordados

- Development únicamente. `database/ProductionDB` sigue reservado; ninguna
  migración, seed ni promoción de este programa se ejecuta en Production.
- La aerolínea elige clave durante la solicitud. La cuenta queda pendiente y
  sin acceso a datos de aerolínea hasta aprobación de Contratos. Como no hay
  verificación de correo, esta alta se habilita solo en Development, con
  protección de abuso y sin recuperación por correo simulada.
- OCC registra vuelos manuales con procedencia auditable. FlightAware no está
  implementado. El catálogo contractual, no una solicitud repetida por vuelo,
  determina los servicios base; los adicionales conservan aprobación propia.
- OCC administra turnos; Gestión Humana administra habilitaciones, carnets
  registrados, ausencias y disponibilidad. No se inventa el catálogo de
  catorce turnos ni se afirma que ELEVANT emite permisos aeroportuarios.
- Se factura solo servicio ejecutado y aprobado, con cantidad y tarifa
  congeladas y ajustes justificados. No hay impuestos calculados, NCF/e-NCF,
  pasarela bancaria, pagos parciales ni horas extra cobrables en este bloque.
  Finanzas confirma un pago completo de prueba y el recibo es no fiscal.
- El portal no muestra banners de «demo». Los PDF llevan discretamente
  «Documento de prueba · sin validez fiscal»; datos y cuentas sintéticos se
  distinguen internamente por procedencia Development.
- Correo de alertas, Google Maps remoto, FlightAware en vivo, overtime,
  notificaciones del SO con Mobile cerrada y despliegue Production se difieren.

## Garantía de convergencia

SQL Server es la autoridad. Cada comando de negocio persiste su estado y un
evento de outbox en la misma transacción. Un trabajador crea un feed durable
por destinatario autorizado y envía por `/hubs/operations` una invalidación
`ChangedV1` sin contenido sensible (solo `eventId`); el cursor y el recurso
se obtienen mediante lectura HTTP autorizada, para no revelar el alcance de
una estación revocada en una conexión WebSocket aún abierta.
`GET /api/v1/changes?after&limit` entrega el feed paginado con
cursor opaco. Los clientes reconsultan los recursos en HTTP tras el aviso,
al conectar/reconectar, al recuperar foco y mediante polling acotado de
respaldo; ignoran avisos duplicados o fuera de orden. Se revalida el acceso
actual antes de leer eventos o documentos. Un WebSocket no es la fuente de
verdad y no promete visualización instantánea sin red.

Con red disponible en la carga de aceptación: p95 de cambio visible menor de
3 segundos y convergencia por fallback antes de 30 segundos. Mobile Agent
sincroniza al volver al primer plano y reproduce comandos pendientes con
identificador estable de dispositivo y clave idempotente; no sobrescribe
conflictos silenciosamente. La API Development mantiene una sola réplica hasta
que exista backplane y afinidad probados.

## Interfaces y estado

OpenAPI define la superficie de afiliación, catálogo, solicitudes, contrato,
turnos, habilitaciones, vuelos/operaciones, prefactura, disputa, conciliación,
factura, pago, recibo, documentos, reportes y feed de cambios. Las escrituras
usan UUID públicos, control de concurrencia, idempotencia donde un reintento
puede duplicar efectos y `ProblemDetails`; el servidor deriva tenant, estación
y rol de la membresía autenticada. Se preservan historia contractual,
operativa y financiera; los PDF inmutables se guardan en almacenamiento privado
S3-compatible y SQL conserva metadatos, checksum y llave de objeto.

## Datos, pruebas y entrega

Un cargador sintético Development, determinista e idempotente, agrega historia
coherente, operaciones actuales y futuras, importes reconciliables y casos
abiertos; no reemplaza filas existentes. El nombre visible del tenant legado
se cambia mediante una acción administrativa auditada, conservando identidad
y relaciones. Credenciales permanecen fuera del repositorio y artefactos CI.

Cada módulo tiene pruebas RED→GREEN de reglas y SQL real. Un Playwright live,
sin stubs de `/api/v1/**`, prueba Public Web y AVIAM Web contra el mismo API/DB;
`adb/UIAutomator` conduce el Pixel Tablet en la misma operación. Se comprueban
transiciones, persistencia tras recarga, aislamiento, 404, duplicados,
desconexión/reinicio, revocación y PDF. CI verde precede cada merge. El
operador promociona manualmente Development DB→API→webs mediante artefactos
inmutables y verifica estados, salud, rutas y el ciclo desde PC y emulador por
Tailscale. No se muta el VPS desde esta especificación.
