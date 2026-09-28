# Cierre del ciclo integral Development

## Punto de partida y regla de entrega

La rama aislada parte del merge #115 (`637ba69`) y se avanzó por fast-forward
hasta `6c46a4b` (#117), que también contiene #116. #114 aportó gobierno e
ingreso comercial; #115 refinó esa frontera; #116 agregó perfiles de rampa,
gobernanza de aerolíneas y confirmación de tarifas; #117 añadió medios privados
S3 y ajustes visuales del acceso. Ninguno completó el ciclo integral.
Este programa termina solamente cuando los tres clientes operan contra una API
y una base Development compartidas, sin respuestas simuladas en sesiones
remotas. Un módulo no conectado se considera trabajo pendiente, aunque su
pantalla exista. No se elimina una advertencia de datos sintéticos mientras el
contenido debajo continúe saliendo de fixtures o almacenamiento del navegador.

Mantener los PDF de prueba marcados como no fiscales. No tocar Production ni
promocionar el VPS desde el agente; el operador ejecutará cada checkpoint.

## Inventario de integración tras #116 y #117

| Sesión | Lecturas/escrituras canónicas | Brecha visible o heredada |
| --- | --- | --- |
| OCC | planificación, revisión, chat y notificaciones usan `/api/v1` | dashboard con fixture; monitoreo/mapa mezclan planificación con datos estáticos; reportes no son historial financiero |
| Contratos | inicio, ingreso, catálogo, borradores, confirmación de tarifas y medios comerciales usan `/api/v1` | Contratos, Servicios y Reportes heredados aún llaman `/api/contracts/*`, ausente del OpenAPI; comunicaciones locales |
| Finanzas | servicios aprobados y borrador de prefactura usan `/api/v1/finance` | inicio, conciliación y tarifas son locales; prefacturación heredada llama `/api/finance/preinvoices` y reportes `/api/finance/reports`, ausentes del OpenAPI |
| Gestión Humana | sesión y perfil base de agente de rampa con estaciones usan API y DB; #116 vinculó el rol `RAMP_AGENT` mediante Superadministración | dashboard con fixture; terminales, turnos, permisos y cualificaciones aún necesitan interfaz canónica; los módulos heredados llaman `/api/hr/*` |
| Superadministrador | gobierno, provisión, gestión de aerolíneas y medios de logos/avatares usan `/api/v1` | comprobar en vivo estados, auditoría y flujos de cuentas nuevas |
| Aerolínea | sesión, bootstrap, contratos y comentarios de borrador usan API canónica; esta rama agrega historial paginado, detalle básico, lectura de solicitudes y prefacturas publicadas tenant-scoped | crear/cancelar solicitudes, documentos, factura/recibo y reportes siguen pendientes; el detalle aún no contiene servicios ni evidencia aprobada |
| Mobile Agent | rutas activas usan `/api/v1/ramp`, chat y notificaciones | sincronización pendiente; adaptadores `/api/mobile/*` heredados no están montados en las rutas activas |

La tabla es auditoría estática de código y OpenAPI, no una prueba de ejecución
en VPS. Una llamada heredada solo cuenta como 404 efectivo si el módulo la
monta en la configuración de prueba; el gate en navegador debe capturarla.

### Reglas para no solapar los merges recientes

- Mantener el acceso comercial de #115/#116: solicitud pública de cuatro
  pasos sin contraseña → revisión de Contratos → provisión de
  Superadministrador. No recuperar el registro paralelo del prototipo.
- Extender `RampProfilesController`/`EfRampProfileStore` de #116 y la
  elegibilidad OCC existente; no crear otra tabla de agentes ni otro vínculo
  entre persona, cuenta móvil y estaciones. La interfaz de Gestión Humana
  debe distinguir perfil base de cualificación/turno/permiso operativo.
- Conservar las cuatro migraciones aditivas de #116/#117 y generar cualquier
  migración nueva encima de su snapshot. No duplicar `MediaAsset`, bucket ni
  configuración `MediaStorage`. Para factura/recibo, reutilizar la infraestructura
  privada S3, pero crear metadatos y autorización financiera/tenant propios;
  `ICommercialMediaStore` no autoriza documentos financieros.
- Las 51 referencias AVIAM no son 51 clientes verificados. Solo contratos y
  cuentas aprovisionadas otorgan acceso; el enriquecimiento visual no puede
  ampliar el tenant ni sembrar identidad legal inventada.
- El cuerpo de la PR #117 declara la preparación manual de Garage como
  prerrequisito operativo y no acredita despliegue. El usuario informa que
  #116/#117 ya están en VPS; verificar estado y S3 con el operador antes de
  probar medios, sin mutar el host desde este worktree.

## Tramo 1: matriz de contratos y bloqueo de rutas falsas

1. Inventariar cada llamada de `private-web`, `public-web` y `mobile-agent` y
   compararla con OpenAPI compilado. Clasificarla en lectura/escritura real,
   prototipo aislado o ruta inexistente. Añadir una comprobación automatizada
   para las rutas activas de las sesiones remotas y sus estados de carga,
   vacío, error y autorización.
2. Verificar las seis sesiones (OCC, Contratos, Finanzas, Gestión Humana,
   Superadministrador y aerolínea) y Mobile Agent con pruebas de contrato.
   Una ruta inexistente falla el gate; una pantalla de prototipo no pasa por
   integración aunque responda 200.
3. Documentar en el Vault el estado actual comprobado, sin presentar este
   plan como capacidad ya entregada.

## Tramo 2: operaciones y personal autoritativos

1. Extender lecturas tenant-scoped de aerolínea: historial paginado de vuelos
   propios, detalle con servicios/evidencia aprobada y solicitudes propias.
   Autorizar por membresía vigente y pertenencia histórica de la operación,
   sin exigir que hoy siga vigente el contrato de esa estación.
2. Partir de los perfiles base y estaciones ya persistidos por #116; añadir
   lecturas/escrituras reales de habilitaciones, permisos registrados, turnos
   y ausencias en Gestión Humana. OCC consulta elegibilidad
   calculada por fecha, estación y servicio; no puede asignar personal no
   habilitado. Agregar pruebas de concurrencia, revocación y vencimientos.
3. Poblar Development mediante el seeder determinista con identidades
   sintéticas, operaciones pasadas/presentes/futuras y evidencia coherente. La
   repetición del seed no cambia filas existentes ni duplica registros.

## Tramo 3: cierre financiero no fiscal

1. A partir de los `commercial.preinvoices` con snapshots inmutables, agregar
   revisión, disputa, resolución y conciliación auditadas. Solo líneas con
   aprobación OCC válida y sin reserva previa pueden llegar a factura.
2. Emitir factura de prueba inmutable con número único, moneda y total
   congelados, sin impuestos/NCF. Registrar pago completo de prueba con clave
   idempotente, referencia y actor; reintentos no duplican el cobro.
3. Generar documento y recibo de prueba no fiscal, comprobar hash, guardar
   binarios en el almacenamiento S3 privado introducido por #117 y metadatos
   financieros separados en SQL. La aerolínea solo
   descarga sus propios documentos tras revalidación de alcance.
4. Probar en SQL real idempotencia, carrera, doble facturación, cambio de
   contrato posterior, acceso cruzado, reinicio y documento corrupto/ausente.

## Tramo 4: clientes, convergencia y aceptación

1. Sustituir los servicios prototipo de los módulos activos por clientes
   OpenAPI. Conservar diseño y vocabulario, pero mostrar únicamente datos
   sembrados o creados por la API; eliminar rótulos de demostración solo tras
   la sustitución. Acciones futuras permanecen deshabilitadas sin llamar rutas
   inexistentes.
2. Cada comando publica cambio durable en la misma transacción. Los clientes
   revalidan por HTTP tras `ChangedV1`, reconexión, foco y polling de respaldo;
   medir p95 <3 s con red y convergencia <30 s por fallback.
3. Playwright sin stubs de `/api/v1/**` recorre solicitud pública → Contratos
   → Superadministrador → OCC → Mobile Agent (Pixel Tablet) → revisión OCC →
   Finanzas → factura/pago → descarga de aerolínea, con el mismo identificador
   de operación. Repetir recarga, offline/replay, revocación, acceso cruzado,
   errores, PDF y ausencia de 404.
4. Pasar suites, OpenAPI generado, modelo EF, Vault y CI. Integrar PRs en
   orden DB → API → clientes; solo después pedir al operador promoción manual
   y verificar pruebas de navegador/emulador sobre VPS.

## Gate de finalización

- Ninguna sesión remota consume fixtures, `localStorage` como autoridad de
  negocio ni `/api/...` del backend prototipo.
- Todos los módulos visibles tienen API/DB real o un estado vacío real; ninguna
  acción habilitada apunta a un endpoint inexistente.
- La misma operación es trazable desde solicitud hasta recibo no fiscal.
- La suite local y CI pasan, y el operador confirma DB/API/webs saludables y
  una ejecución end-to-end remota. Hasta entonces, no declarar el plan completo.
