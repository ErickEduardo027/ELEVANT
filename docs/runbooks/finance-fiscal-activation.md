# Finanzas: simulación fiscal, archivo y gates de activación

## Alcance y estado

Este runbook describe las capacidades de la rama de integración y los gates de una futura conexión real. No autoriza contratar, activar un proveedor, cargar certificados, emitir e-CF, promover Production ni desplegar. El proveedor fiscal está **sin seleccionar**. La conectividad real permanece fuera de la etapa aprobada.

Fuentes de implementación: [política de modos](../../backend/Elevant.Application/Finance/FinanceFiscalPolicy.cs), [configuración/DI](../../backend/Elevant.Infrastructure/DependencyInjection.cs), [dispatch](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinanceFiscalStore.Dispatch.cs), [archivo local](../../backend/Elevant.Infrastructure/Finance/FinanceFiscalFileArchive.cs) y [API fiscal](../../backend/Elevant.Api/Controllers/FinanceFiscalDocumentsController.cs). Decisión: [ADR-0018](../adr/0018-finance-commercial-platform-and-fiscal-simulation.md).

## 1. Seleccionar el modo permitido

| Configuración | Resultado actual |
| --- | --- |
| `FinanceFiscal:Mode` ausente o `Off` | Predeterminado. No crea trabajo ni ejecuta simulación. Lecturas autorizadas y preflight XML independiente siguen disponibles. |
| `LocalSimulation` + ambiente `Development` o `Test` | Habilita exclusivamente el simulador local. No llama a proveedor ni DGII, no firma y no asigna e-NCF. |
| `LocalSimulation` en otro ambiente | La política bloquea la ejecución. No tratar el nombre del host o base como sustituto del ambiente configurado. |
| `ProviderSandbox` | Bloqueado: `ProviderNotConfigured`. No se habilita agregando una clave, URL o certificado. |
| Valor de modo desconocido | Error de configuración al arrancar. |

El ambiente efectivo se obtiene de **`DOTNET_ENVIRONMENT`, luego `ASPNETCORE_ENVIRONMENT`, y por defecto `Production`**. Si ambas variables existen, la primera gana en las opciones fiscales. Use valores coherentes con el host y verifique `GET /api/v1/finance/fiscal-documents/status`, no una suposición del navegador.

Las variables de proceso equivalentes usan doble guion bajo, por ejemplo `FinanceFiscal__Mode`. Esta etapa no define claves reales de proveedor ni un bloque de configuración de sandbox para rellenar después.

## 2. Elegir explícitamente el archivo de simulación

| `FinanceFiscal:ArchiveMode` | Requisitos y alcance |
| --- | --- |
| Ausente o `PrivateObjectStore` | Predeterminado. `FinanceFiscalPrivateArchive` utiliza el almacén S3 privado existente a través de `IPrivateFinancialObjectStore`. Requiere configuración válida de MediaStorage cuando se lee/escribe un objeto. |
| `LocalDirectory` | Solo Development/Test. Exige `FinanceFiscal:ArchiveDirectory` no vacío. Registra `FinanceFiscalFileArchive`; permite probar artefactos fiscales sin credenciales S3. |
| Valor desconocido | Error de configuración al arrancar. |
| `LocalDirectory` en Production u otro ambiente no permitido | Rechazado al arrancar, incluso si el modo fiscal es Off. |

Para QA local, configure en el proceso **todos** estos valores después de preparar el directorio:

| Clave | Valor de QA |
| --- | --- |
| `DOTNET_ENVIRONMENT` o `ASPNETCORE_ENVIRONMENT` | `Development` o `Test`, coherente con la configuración del host |
| `FinanceFiscal:Mode` | `LocalSimulation` |
| `FinanceFiscal:ArchiveMode` | `LocalDirectory` |
| `FinanceFiscal:ArchiveDirectory` | Ruta absoluta real elegida por el operador, privada, persistente y fuera del repositorio, webroot, carpetas públicas y salidas de build |

El operador comprueba permisos del directorio y que ningún servidor estático, volumen público o sincronizador lo publique. El adaptador exige la ruta y el ambiente permitido, pero no inspecciona todas las ACL ni la configuración externa del servidor web.

El adaptador deriva el nombre físico de SHA-256 de la clave interna; no acepta claves HTTP del cliente como rutas. Escribe un temporal, fuerza flush y publica por rename sin sobrescribir. Repetir los mismos bytes bajo la misma clave es idempotente; bytes distintos fallan. Una nueva instancia con el mismo directorio recupera los originales. [La prueba de reinicio de instancia y conflicto](../../backend/tests/Elevant.UnitTests/Application/FinanceFiscalFileArchiveTests.cs) cubre estas propiedades.

El hash y la inmutabilidad de aplicación no equivalen a cifrado, Object Lock/WORM ni backup. Conservar el directorio al reiniciar/recrear el proceso es responsabilidad de la operación. `LocalDirectory` cambia **solo los artefactos fiscales**: soportes de gastos y PDFs comerciales mantienen su almacenamiento privado existente y pueden requerir S3 por separado. Nunca hay fallback silencioso entre almacenes; cambiar de backend o directorio no mueve los originales anteriores.

## 3. Preflight comercial y permisos

Antes de crear una simulación:

1. Verifique que se aplicó la cadena de migraciones aprobada y que la API compatible consulta la misma base del ambiente declarado. No deshabilite el control de modelo pendiente para continuar QA.
2. Use una cuenta interna AVIAM vigente, estación concedida y permisos resueltos por el servidor: `finance.fiscal.read` para lectura; `finance.fiscal.manage` y `finance.fiscal.simulate` para preparar/ejecutar.
3. Elija una factura comercial ya emitida y autorizada, no un importe libre. Debe conservar snapshot comercial y tratamientos tributarios explícitos en todas sus líneas.
4. Compruebe neto, descuento, impuesto, bruto, moneda y jerarquía contra el snapshot emitido. El canónico no lee una política actual para reparar historia.
5. `Unconfigured`, política ausente/ambigua o datos monetarios incongruentes bloquean. No cambie impuesto desconocido a cero ni declare exento para desbloquear.
6. El snapshot actual puede tener `issuerTaxRegistration = null` y `customerTaxRegistration = null`: no existe una fuente fiscal revisada para completarlos. La simulación no inventa RNC, registro, domicilio ni secuencia. Estos null son bloqueantes para una futura emisión real.
7. Verifique que el archivo privado elegido es persistente y recuperable. Ningún objeto se entrega mediante URL pública.

No envíe roles, departamento de aprobación ni un EmployeeId para suplantar al solicitante. El acceso a gastos propios deriva del Employee activo y membresía interna; la revisión departamental deriva del administrador y su departamento. Las decisiones/pagos finales de Finanzas conservan sus permisos y prohibición de autoaprobación.

## 4. Ensayo local verificable

1. Consulte `GET /api/v1/finance/fiscal-documents/status`. Debe mostrar ambiente correcto, `LocalSimulation`, permiso de ejecución y la advertencia de simulación.
2. Cree el documento mediante `POST /api/v1/finance/fiscal-documents` con `requestId` estable, `invoiceId` y resultado sintético explícito: Accepted, Rejected, Conditional, Pending, Timeout o Unknown. Una creación igual se reproduce; otro contenido bajo la misma intención entra en conflicto.
3. Lea el documento y conserve su versión. Ejecute `POST /api/v1/finance/fiscal-documents/{documentId}/simulate` con un UUID estable de intención de ejecución y `expectedVersion`.
4. El servicio archiva JSON canónico, XML neutral y manifest; relee/verifica bytes antes de reclamar el único intento. Después conserva respuesta y eventos. Compare `state` y `artifactCompletion` por separado.
5. Descargue artefactos por las rutas autorizadas `.../{documentId}/artifacts/{artifactId}`. Verifique longitud, SHA-256 y manifest. El XML debe identificarse como `FiscalSimulation`, con `officialSchema=false`; no es XML e-CF.
6. Repita la misma intención: no debe crear otro documento ni otro envío. Una petición modificada o versión obsoleta debe producir conflicto.
7. Ensaye falta/fallo del archivo original: debe resultar `ArchiveBlocked` sin llamada al adaptador. Tras corregir almacenamiento, relea estado/versión y use una nueva intención solo si el documento sigue en un estado previo al reclamo de envío.
8. Ensaye timeout, cancelación posterior al reclamo y resultado desconocido: debe conservar incertidumbre y evitar otro envío, también bajo reintento concurrente.
9. Reinicie el proceso/instancia usando **la misma base y el mismo directorio o almacén**; compruebe que descarga exactamente los mismos bytes. Un objeto ausente o alterado falla cerrado, sin reconstruir originales desde datos actuales.
10. Verifique 401/403/404 de ámbito, auditoría, pistas dirigidas y separación del reporte fiscal frente al de simulación.

`Accepted` en este ensayo significa **resultado simulado**. Todos los documentos muestran `SIMULATION WITHOUT FISCAL VALIDITY`; e-NCF, respuesta DGII, firma oficial y QR oficial no aparecen. Los identificadores `SIM-` no son comprobantes.

## 5. Validación XML: cuatro comprobaciones distintas

| Comprobación | Capacidad actual | Evidencia que falta para emitir |
| --- | --- | --- |
| Estructura XSD | Preflight offline E31/E32/E33/E34 con XSD oficiales fijados, sin resolvers de red | Mapping fiscal tipado y datos reales revisados por tipo |
| Firma | Detecta presencia de Signature; criptografía = NotPerformed | Firma real, digest/referencias, certificado, cadena, vigencia y revocación según contrato/norma aplicable |
| Reglas de negocio | Snapshot financiero coherente y tratamientos explícitos; no certificación tributaria | RNC/cliente, rangos autorizados, reglas fiscales y aritmética cruzada independientes del XSD |
| Aceptación | FiscalAcceptance = NotPerformed | Acuse auténtico y conciliado del proveedor/DGII |

Use `POST /api/v1/finance/fiscal-xml/validate` solo para el preflight offline con permiso `finance.fiscal.read`. No almacena ni despacha el XML. Un HTTP 200 contiene el resultado de validación; no implica que el XML pasó. La [referencia original DGII](../reference/dgii-ecf-schema-sources.md) conserva URL, hash, wildcard de firma y límites de cada XSD. No cambie el schema, no use fixtures de pruebas como documentos operativos y no presente el XML neutral del simulador como validado por esos XSD.

## 6. Matriz de incidentes y recuperación

| Observación | Acción permitida en esta etapa |
| --- | --- |
| Off / Disabled | Confirmar intención de QA y configuración de proceso; no crear trabajos manualmente en SQL. |
| ProviderNotConfigured | Detener activación. Registrar proveedor pendiente; no probar claves o endpoints reales. |
| ArchiveBlocked antes del reclamo | Corregir almacenamiento y comprobar bytes/alcance; releer estado y versión antes de un nuevo intento previo al envío. |
| Dispatching tras caída, Unknown o timeout | Conservar evidencia y bloquear reenvío ciego. La conectividad de consulta/reconciliación real todavía no está implementada; una futura integración debe resolver el resultado por identidad/idempotencia del proveedor. |
| Respuesta existente con archivo fallido | Conservar Unknown/archivo incompleto y recuperar los bytes originales; no marcar Accepted manualmente. |
| Hash/tamaño discordante o archivo ausente | Preservar evidencia, detener descarga/avance, recuperar del backup correspondiente y verificar. Nunca regenerar el original ni sobrescribir un objeto conflictivo. |
| Callback duplicado, fuera de orden o de otro ambiente | Validar autenticación y bytes antes de aplicar; guardar historial idempotente sin retroceder estados terminales. El autenticador runtime actual rechaza todos los callbacks. |
| Crédito o saldo a favor | Emitir/aplicar la nota comercial que corresponda; una devolución de efectivo requiere su movimiento y permiso separados. |

### Backup y restore

SQL guarda metadatos, snapshots, hashes, intención y eventos; el almacén conserva bytes. Un `.bak` de SQL no incluye S3 ni el directorio local. El [backup Development](../../database/DevelopmentDB/scripts/backup/README.md) y la [verificación de recuperación](../../database/DevelopmentDB/scripts/recovery/README.md) son las fuentes de procedimientos de base; no afirman respaldar objetos.

Para certificar recuperación, el operador debe coordinar un punto consistente de SQL y archivo privado, conservar permisos/configuración y la lista de hashes, y restaurar en un destino aislado. Verifique marcador de ambiente, migraciones, relaciones y descarga de originales por API. Compare bytes/hash/longitud contra metadatos y manifest, incluyendo respuestas/callbacks cuando existan. Registre faltantes y el punto de recuperación antes de promover cualquier restore.

No restaure Production en Development ni borre historia para hacer pasar un Down. Las migraciones comerciales/tributarias tienen guardas contra pérdida de historia; el rollback operativo exige un backup verificado y la compatibilidad de API, no una reversión forzada del esquema.

## 7. Gates pendientes para una conexión real

Todos requieren evidencia revisada y una autorización posterior; esta lista no habilita `ProviderSandbox`.

- **Proveedor y contrato:** selección explícita, responsable, versión de API/esquemas, ambientes/base URL aprobados, límites, política de cambios/deprecación, errores y condiciones de prueba.
- **Idempotencia y timeout:** identidad única end-to-end, duración/alcance de deduplicación, consulta por identidad tras timeout, recuperación de reclamos interrumpidos y prohibición de reenvío ambiguo. Resolver contractualmente cualquier ausencia de Idempotency-Key.
- **Callbacks:** autenticación sobre bytes originales, integridad, replay, ambiente/tenant/documento, secuencias, reintentos y conciliación de entregas perdidas. No asumir HMAC ni reintentos que el proveedor no haya contratado.
- **Datos fiscales:** fuente revisada de RNC y registro de emisor/cliente, domicilio y clasificación; validación de faltantes y cambios. Los null actuales no se sustituyen por valores sintéticos.
- **Numeración:** tipos soportados y rangos/secuencias autorizados por ambiente, concurrencia, expiración y trazabilidad; nunca derivar e-NCF del UUID o de una factura NF.
- **Certificados y firma:** custodio/gestor de secretos, generación/uso del certificado según contrato, rotación/revocación, firma y verificación criptográfica; no claves en navegador, Git o logs.
- **Validación separada:** mapping tipado por documento, XSD oficial con hashes/dependencias revisadas, reglas de negocio/tributarias, firma criptográfica y acuse final auténtico. Pasar una capa no omite las otras.
- **Archivo y recuperación:** originales/manifest/respuestas íntegros antes/después del envío, retención acordada, control de acceso, backup del objeto y SQL, ensayo de restore y evidencia de hashes.
- **Permisos y auditoría:** segregación de preparación/envío/consulta, alcance por cuenta/estación/tenant, revocación, eventos auditados sin XML/PII/credenciales en logs; exportaciones y descargas privadas.
- **Aceptación:** casos aprobados/rechazados/condicionales/pendientes, duplicados/carreras, timeout desconocido, callback hostil, caída/reinicio, archivo fallido y recuperación. Revisión financiera, técnica y del operador antes de cambiar el estado de esta etapa.

[Integraciones](https://factura.com.do/integraciones) y [desarrolladores de factura.com.do](https://factura.com.do/desarrolladores) son referencias de evaluación, **no proveedor seleccionado**. La documentación pública declara brechas de idempotencia, autenticación criptográfica y reintento de webhooks; deben resolverse antes del gate, no suponerse.

## Handoff de QA

Conserve un acta saneada con commit/artefacto probado, ambiente y modo efectivos, backend de archivo, migraciones, casos/resultados, hashes no sensibles y pendientes. No incluya XML real, PII, claves, connection strings, certificados ni rutas privadas de operación. Las pruebas locales demuestran únicamente su alcance; la suite integrada, QA de clientes y cualquier promoción se registran por separado.
