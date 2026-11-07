# 0018 — Plataforma comercial de Finanzas y simulación fiscal

- **Estado:** aceptado para el alcance del [plan aprobado](../superpowers/plans/2026-10-18-finance-platform.md).
- **Decisión:** 2026-10-18; contraste de las fuentes de esta ampliación: 2026-10-19.
- **Alcance de entrega:** código y validación local de la rama de integración. Este ADR no acredita promoción, despliegue ni autorización de emisión real.
- **Amplía:** [ADR-0016](0016-finance-tariffs-charges-and-receivables.md). Conserva sus decisiones de tarifas, aprobación contractual y compatibilidad; amplía cartera, paquetes, CxP, gastos e infraestructura fiscal local.

## Contexto

La operación de rampa necesita relacionar lo aprobado por OCC con el contrato que autorizó el servicio, su valoración, los documentos comerciales y sus saldos. Una factura emitida, un cobro registrado, una aplicación y una aceptación fiscal representan hechos distintos. Confundirlos permite alterar historia, aplicar fondos dos veces o presentar una simulación como un comprobante válido.

El plan incluye cuentas por cobrar y pagar, proveedores y gastos de empleados. Libro mayor, conciliación bancaria, pagos electrónicos, firma documental general, hojas colaborativas y ESG permanecen fuera del alcance. El proveedor fiscal sigue **sin seleccionar**.

Odoo 19.0 se utilizó como referencia de flujos de negocio, fijado al commit `53ec5874899470427115254cf09f83c969ab360d`. La [matriz de adaptación](../reference/odoo-finance-adaptation.md) registra archivos, métodos y licencias revisados. ELEVANT implementa sus propias reglas en C# y React, mantiene su diseño visual y no incorpora código ni runtime de Odoo.

## Decisión

### 1. Una API y persistencia compartida

Se conserva el monolito modular .NET, una base lógica por ambiente y los clientes Next/Expo existentes. Domain contiene agregados y políticas; Application, casos de uso y puertos independientes de HTTP; Contracts, DTO públicos; Persistence, SQL Server y mappings; Infrastructure, archivo y adaptadores; Api, composición y controladores.

Los clientes no acceden a SQL ni al proveedor fiscal. JWT identifica la cuenta; membresía interna AVIAM, departamento efectivo, estaciones y permisos se resuelven en el servidor. El portal deriva la aerolínea de la membresía. Un filtro de estación, departamento o empleado recibido del cliente solo restringe el ámbito permitido.

### 2. Precios, paquetes y documentos congelados

- Finanzas gobierna catálogo, tarifas y paquetes versionados. Contratos propone negociación y enmiendas; Finanzas decide la versión contractual y OCC aprueba la ejecución.
- La valoración conserva moneda, tarifa, unidad, cantidad, evidencia y cálculo. Datos faltantes, cobertura ambigua o FX ausente bloquean; no se infiere precio cero.
- Los paquetes fijan base, componentes incluidos y bloques de excedente por turnaround, tramo de vuelo o período contractual. Se reserva consumo dentro de la transacción serializable de prefactura.
- Un ámbito con una prefactura activa todavía no facturada bloquea otra reserva: `package_scope_has_unissued_preinvoice`. Evita que un documento dependa de cobertura que otro borrador aún puede liberar. La anulación conserva historia y libera reservas; una factura emitida conserva su consumo.
- GPU con base 500, 60 minutos incluidos y bloques comenzados de 15 minutos a 20 produce 500/520/520/540/540 para 60/61/75/76/83 minutos. Es un caso sintético de aceptación, no una tarifa comercial publicada.
- El complemento por mínimo es una línea trazable: `max(0, mínimo − ejecutado) × precio`. Se aplica a versiones contractuales modernas con `PricingPolicyVersion > 0`; las versiones heredadas conservan su semántica. La cobertura de paquete no recibe además el mínimo del servicio.
- Una base porcentual sobre un servicio cubierto por paquete que no esté resuelta explícitamente bloquea con `package_percentage_basis_required`.

> **Actualización (6 de noviembre de 2026).** Contratos crea las enmiendas con un comando propio, desde la última versión aprobada, y Finanzas puede descartar un borrador de paquete (`Discarded`) o retirar uno publicado (`Retired`). Los contratos aprobados conservan el paquete congelado. Ver [ADR-0037](0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md).

> **Actualización (7 de noviembre de 2026).** La enmienda parte ahora de la versión que rige (aprobada y firmada por ambas partes sobre la misma huella, o la heredada con la que el contrato se activó), y no se crea mientras otra versión aprobada espera las firmas. Aprobar ya no reemplaza la versión en vigor: el reemplazo ocurre en la segunda firma, y una enmienda retroactiva no cambia precios antes de firmarse. La valoración de paquetes toma esa segunda firma como frontera. Los recargos congelados y los paquetes vinculados forman parte del contenido firmado. Ver [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

La prefactura permite ajustes justificados y recálculo explícito en borrador. La disputa bloquea la emisión. La factura congela las líneas aceptadas, jerarquía, razones, importes y snapshot comercial; una corrección posterior usa notas vinculadas, sin reescribir el original.

### 3. Tratamientos tributarios explícitos

Las políticas tributarias son versionadas, publicadas y acotadas por aerolínea, estación, moneda, concepto y vigencia. Una coincidencia ambigua falla. Se conserva por línea política, tratamiento, tasa o fundamento, neto, descuento, impuesto, bruto y fecha de captura.

`Unconfigured` significa **desconocido**, con impuesto nullable; no equivale a exento, no sujeto ni tasa cero. Los tratamientos `Exempt` y `NotSubject` requieren fundamento explícito. La compatibilidad permite conservar documentos comerciales históricos sin inventar un tratamiento; la preparación fiscal los bloquea si carecen del snapshot tributario emitido requerido.

La factura conserva identidades comerciales de emisor y cliente. Como el modelo no aporta todavía una fuente fiscal revisada de registros tributarios y domicilio, `issuerTaxRegistration` y `customerTaxRegistration` permanecen explícitamente `null`. No se completan desde nombres, códigos de organización ni fixtures. Cambiar una política o ficha actual no repara una factura histórica.

### 4. Cobro, aplicación, nota y devolución separados

El recibo de cartera es independiente de las aplicaciones. Puede quedar como anticipo, aplicarse parcialmente a varias facturas y conservar remanente. Cada aplicación valida moneda/FX congelado, saldo y disponibilidad bajo transacción serializable y control de versión.

El saldo incorpora facturación, débitos, créditos y aplicaciones netas de reversos. Los pagos y notas heredados se leen una vez como hechos históricos: no se copian a nuevos movimientos para contabilizarlos de nuevo.

Las notas de crédito/débito referencian factura y líneas originales, con límites y razón. **Una nota de crédito no devuelve dinero.** El reverso o la devolución es otro movimiento vinculado y autorizado; no borra el recibo ni la factura. Registrar un recibo tampoco demuestra liquidación bancaria.

### 5. Proveedores, CxP y gastos internos

| Flujo | Hechos persistentes y controles |
| --- | --- |
| Proveedor | Alta, edición y retiro lógico con versión y motivo; ámbito de estación. |
| Factura de proveedor | `Draft → Submitted → Approved/Rejected`; referencia normalizada única por proveedor mediante índice SQL; líneas congeladas al presentar; rechazo con razón. |
| Pago CxP | Registro separado de aplicaciones; múltiples facturas, pagos parciales y remanente; sin sobreaplicación bajo carrera SQL. |
| Gasto propio | Cuenta interna con Employee activo crea, adjunta soportes, presenta y lee su propio gasto sin necesitar permisos de Finanzas. El servidor vincula el empleado; no hay suplantación por un EmployeeId del cliente. |
| Revisión departamental | Administrador efectivo revisa únicamente su departamento y estaciones autorizadas; nunca su propio gasto. |
| Decisión de Finanzas | Aprobación final después de la revisión departamental; sin autoaprobación y con personas revisoras distintas. |
| Reembolso | Registro separado, parcial o total sobre gasto aprobado; exige permiso de pago de Finanzas y prohíbe pagarse a sí mismo. |

Estación, aerolínea, turnaround y servicio son dimensiones operativas opcionales, además de la estación de seguridad obligatoria. Se valida su relación. Los soportes conservan metadatos, longitud y hash en SQL y bytes privados; las API no aceptan claves arbitrarias ni publican URLs o PII del personal al portal.

### 6. Tres ejes de estado independientes

| Eje | Lo que establece | Lo que no establece |
| --- | --- | --- |
| Comercial | Prefactura, aceptación/disputa, factura y correcciones | Cobro o validez fiscal |
| Cartera | Recibo/pago, aplicación, reverso, devolución y saldo | Aceptación de DGII o confirmación bancaria |
| Fiscal | Intención, archivo, intento y respuesta documental | Modificación del importe comercial o cobro |

El modo es `Off` por defecto. `LocalSimulation` solo se ejecuta en `Development` o `Test`, sin transporte al proveedor ni DGII. `ProviderSandbox` está bloqueado con `ProviderNotConfigured`: no existe activación mediante una clave placeholder.

El documento fiscal local congela el snapshot **ya emitido**, crea una intención durable, archiva JSON, XML neutral y manifest, verifica los bytes y después reclama un único intento. Si falla el archivo previo, queda `ArchiveBlocked` y no llama al adaptador. Timeout, cancelación posterior al reclamo o respuesta incierta se conservan como `Unknown`; no habilitan reenvío ciego. La autenticación de callbacks registrada por defecto rechaza todos; los puertos/inbox no constituyen un webhook de proveedor habilitado.

Los resultados Accepted/Rejected/Conditional/Pending/Timeout/Unknown son simulados y llevan `SIMULATION WITHOUT FISCAL VALIDITY`. Identificadores `SIM-` son internos; e-NCF y respuesta DGII permanecen null. No hay certificado, firma oficial ni QR oficial.

### 7. Archivo y validación con límites explícitos

El archivo predeterminado usa `PrivateObjectStore`, mediante el S3 privado existente. La opción explícita `LocalDirectory` usa archivos atómicos e inmutables con nombres derivados del hash de la clave, solo en Development/Test y en un directorio privado no servido. El arranque rechaza esta opción en Production y exige `ArchiveDirectory`. Este adaptador local cubre artefactos fiscales; no sustituye el almacenamiento de recibos de gastos ni PDFs comerciales.

El preflight offline de e-CF E31/E32/E33/E34 usa XSD oficiales fijados y verifica sus hashes. La [referencia DGII](../reference/dgii-ecf-schema-sources.md) detalla fuentes originales y límites: XSD, presencia de Signature, validación criptográfica, reglas tributarias y aceptación fiscal son comprobaciones separadas. La firma no se valida criptográficamente y la aceptación no se realiza. El XML neutral de simulación no es un e-CF y no se presenta como validado por esos XSD.

### 8. Integridad, auditoría y compatibilidad

Dinero usa `decimal(19,4)` y cantidades `decimal(18,4)`; USD/DOP y FX son explícitos. Las mutaciones usan UUID de intención y hash de contenido, más `expectedVersion` donde cambia un agregado mutable. Repetir la misma intención devuelve el resultado persistido; cambiar su contenido o usar una versión obsoleta entra en conflicto.

Índices únicos, reservas, locks y transacciones serializables protegen los hechos bajo concurrencia. Auditoría y pistas dirigidas de cambio se guardan con la mutación; el feed revalida acceso al entregar. Contratos HTTP nuevos son aditivos; no se amplían a ciegas respuestas estrictas de clientes móviles ya publicados.

Los reportes se calculan desde hechos persistentes y ámbito del actor. Separan efectivo de aplicaciones, notas de devoluciones y simulación fiscal de estado fiscal real. Exportar a CSV/XLSX/PDF requiere permiso y auditoría.

## Alternativas consideradas

- **Instalar Odoo o copiar su interfaz:** descartado; se conserva la arquitectura, código y UI de ELEVANT.
- **Un único estado de factura/pago/fiscal:** descartado porque pierde hechos independientes y la incertidumbre de un envío.
- **Aplicar políticas actuales al histórico:** descartado; solo recalcula borradores mediante acción explícita y nunca revalora facturas emitidas.
- **Activar proveedor con credenciales de ejemplo:** descartado; falta selección, contrato revisado y aceptación técnica/operativa.
- **Borrar o revertir historia para corregir:** descartado; se usan documentos/movimientos vinculados y recuperación verificada.

## Consecuencias y aceptación

Las migraciones aditivas `20261019033625_AddFinanceCommercialPlatform` y `20261019041554_AddFinanceTaxSnapshotsAndCorrections` incorporan estos modelos sin DML de negocio. Sus guardas de Down protegen historia; la recuperación requiere backup de SQL **y** bytes privados. El orden de promoción sigue base → API compatible → clientes.

La evidencia ejecutable incluye [paquetes SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinancePackages.cs), [CxP/gastos SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinancePayables.cs), [tesorería SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTreasury.cs), [impuestos SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTax.cs), [fiscal SQL](../../backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceFiscal.cs), [archivo local](../../backend/tests/Elevant.UnitTests/Application/FinanceFiscalFileArchiveTests.cs) y [preflight XSD](../../backend/tests/Elevant.UnitTests/Application/OfficialEcfXmlValidatorTests.cs). La existencia de pruebas no acredita por sí sola un despliegue ni reemplaza el resultado de la suite integrada y QA de clientes.

La conectividad fiscal real queda fuera de esta etapa autorizada. Requiere selección del proveedor, datos fiscales revisados, política de secuencias/certificados/firma, contrato versionado, idempotencia y reconciliación tras timeout, callbacks autenticados y ensayo de recuperación. El [runbook de activación](../runbooks/finance-fiscal-activation.md) define los gates y las condiciones para detenerse.
