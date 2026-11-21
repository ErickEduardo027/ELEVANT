# ADR-0048: Motor común de reportes (PDF y Excel)

## Estado

Accepted — 2026-11-21.

## Contexto

En la reunión del 16 de noviembre de 2026 el profesor avisó que la revisión siguiente sería «fundamentalmente» de los
reportes. Pidió:

- filtros visibles, con el criterio que produjo el resultado;
- el PDF con la fecha en que se generó y por quién;
- totales de importes;
- un Excel que sirva de base para analizar;
- cifras con contexto, no «números fríos» («8 de 50 este mes»).

Antes de este cambio, los 16 reportes del servidor (6 de OCC, 4 de Gestión Humana y 6 de Finanzas) se exportaban con tres
renderizadores distintos:

- **PDF:** columnas de ancho igual, texto partido por carácter, sin negritas ni totales, «Página N» sin el total y filtros
  como «Estación filtrada» sin nombrarla.
- **XLSX:** sin estilos, anchos, encabezado congelado ni autofiltro, y con las fechas como texto.
- **Filtros:** OCC solo filtraba por período y Gestión Humana tenía un tope de 30 días.
- **Errores de cálculo:** la «Cobertura de habilitaciones» repetía en «Elegibles» el total de agentes de la estación, y
  Finanzas mostraba el porcentaje de cobro con 4 decimales.

## Decisión

**1. Un modelo común, `ReportDocument` (`Elevant.Application/Documents`).**
- **Cabecera:**
  - área («Centro de Control Operacional», «Gestión Humana», «Finanzas»), título y descripción;
  - estación (código y nombre) y período, o la fecha de corte en un reporte «a una fecha de corte».
- **Procedencia:**
  - los filtros aplicados con su valor legible (`ReportFilter`: «Aerolínea: Arajet», nunca un id ni «Estación
    filtrada»);
  - «Generado el dd/MM/yyyy HH:mm (hora local de la estación) por <nombre del usuario>».
- **Tabla:** columnas tipadas `text | number | money | percent | date | datetime | time | duration`, con la moneda fija
  o tomada de otra columna, y filas de celdas tipadas (`ReportCell`).
- **Cierre:**
  - la fila de totales (`ReportTotals`) suma las columnas marcadas como sumables y, si las filas mezclan monedas, va una
    fila por moneda («Total USD», «Total DOP»);
  - el resumen (`ReportMetric`) lleva el contexto de cada cifra («de 40 operaciones (7.5 %)»);
  - las notas y una leyenda opcional en todas las páginas (Finanzas: «Simulación — sin validez fiscal»).
- **Formato (`ReportFormat`):** fijo en es-DO, con coma de miles y punto decimal, fechas `dd/MM/yyyy`, horas de 24 h y
  porcentajes con un decimal. No depende de la cultura del servidor.

**2. Dos renderizadores en `Elevant.Infrastructure/Documents`, sin paquetes nuevos.**
- **PDF** (`ReportPdfRenderer`, PDFsharp con Noto Sans incrustada):
  - membrete con el logo, negritas reales y un bloque de metadatos y otro de indicadores en la primera página;
  - ajuste de línea por palabra (`PdfTextLayout`): solo se parte por carácter una palabra más ancha que su columna, y
    nunca hay «...»;
  - anchos proporcionales al contenido con mínimos y máximos; las cifras, fechas y horas no se parten;
  - página apaisada con 6 columnas o más, o con una tabla más ancha que el retrato, y letra que baja hasta 6,5 pt si
    hace falta;
  - encabezado de tabla repetido en cada página, filas alternas y cifras a la derecha con los mismos decimales en toda
    la columna, para que los puntos queden alineados;
  - fila de totales destacada, estado vacío «No hay datos para estos filtros.» y pie «ELEVANT · AVIAM · Uso interno —
    Página X de Y».
- **Excel** (`ReportXlsxRenderer`, OpenXml con `WorkbookStylesPart`):
  - título y metadatos, y encabezado en negrita blanca sobre navy;
  - paneles congelados bajo el encabezado, autofiltro (con `_xlnm._FilterDatabase`) y anchos calculados;
  - formatos reales: `#,##0.00` en importes, `#,##0` en enteros, fechas de Excel `dd/mm/yyyy`, `dd/mm/yyyy hh:mm`,
    `hh:mm`, `[h]:mm` y `0.0%`;
  - totales con `SUBTOTAL(109, …)`, que siguen al autofiltro. Si hay varias monedas, el total de cada una es
    `SUMPRODUCT(SUBTOTAL(109, OFFSET(…)) * (moneda = "USD"))`;
  - impresión apaisada ajustada al ancho, con el encabezado repetido (`_xlnm.Print_Titles`);
  - la hoja se llama como el reporte (31 caracteres como máximo, sin caracteres inválidos) y una segunda hoja,
    «Filtros», lista los parámetros, el resumen y las notas;
  - el texto va siempre como cadena en línea, así que un valor que empieza por `=` nunca se ejecuta.
- **CSV:** se conserva el de cada área (UTF-8 con BOM, comillas RFC 4180 y fórmulas neutralizadas). El de OCC suma a su
  cabecera los filtros y «por <nombre>».

**3. Las tres áreas exportan por el motor (`IReportRenderer`).**
- Cada área traduce su tabla al documento común:
  - `OccReportDocuments.ToDocument`;
  - `HumanResourcesReportCatalog.ToDocument`;
  - `FinanceReportDocuments.ToDocument`.
- Desaparecen `OccReportRenderer`, `HumanResourcesReportPdfRenderer`/`XlsxRenderer`, `FinanceReportXlsxRenderer` y
  `IFinancialDocumentPdfRenderer.RenderReport`.
- Se mantienen:
  - los códigos de `ReportProblems` (`invalid_report_query`, `report_not_found`, `station_unavailable`,
    `report_too_large`);
  - los límites de filas (OCC: 25 000 filas en CSV y Excel y 5 000 en PDF; Gestión Humana: 5 000);
  - la auditoría de cada exportación, que en OCC guarda además los filtros.
- Los nombres de archivo no cambian.

**4. Filtros y catálogos, siempre aditivos.**
- **OCC:**
  - `airlineId`, `status` (código de `GroundOperationStatus`), `agentId` y `terminalId` son parámetros opcionales de
    `GET occ/reports/{key}` y de su exportación;
  - cada reporte acepta solo los suyos. Otro filtro, un id vacío o un estado desconocido responden 400
    `invalid_report_query`, y un id que no existe no devuelve filas;
  - `ListOccReports` publica en cada reporte `filters` (clave, rótulo, parámetro y, para `status`, las opciones),
    `columnTypes` y `asOfDate`;
  - la página trae `appliedFilters`, `summary`, `totals` y `totalRows` del período completo, además de `stationName` y
    `generatedBy`.
- **Gestión Humana:**
  - el rango pasa de 30 a 366 días (`HumanResourcesReportPolicy.MaxRangeDays`);
  - nuevo `GET human-resources/reports` (`ListHumanResourcesReports`) con los cuatro reportes, sus columnas tipadas y
    `asOfDate`. La «Cobertura de habilitaciones» es a fecha de corte (`to`).
- **Finanzas:**
  - `FinanceReportData.filters` nombra la estación, la aerolínea y la moneda;
  - `FinanceReportMetric.context` da contexto a las cifras de cobro, antigüedad y cuentas por pagar;
  - `FinanceReportDefinition.asOfDate` marca «Cuentas por cobrar» y «Cuentas por pagar».
- Las pantallas usan `asOfDate` para ocultar «Desde».

**5. Reporte nuevo de OCC: «Asignaciones de cobertura» (`coverage-assignments`).**
- Lo pidió el profesor: necesitaba ver cuándo se asignó a un agente y para cuándo cubre.
- Una fila por `PositionCoverage` que empieza en el período (días locales de la estación), incluidas las liberadas, con
  sus columnas:
  - fecha, terminal, posiciones y agente;
  - cubre desde y hasta;
  - asignada el y por (`CreatedAt`, `AssignedByAccountId`);
  - liberada el y por (`ReleasedAt`, `ReleasedByAccountId`);
  - refuerzo.
- Acepta los filtros de terminal y agente.

**6. Correcciones.**
- **«Elegibles» de la cobertura de habilitaciones.** Ahora son los agentes activos de la estación formados en cada
  equipo: los que tienen un ciclo vigente obtenido a la fecha de corte, haya vencido o no. «Habilitados» son los de esos
  agentes cuyo ciclo sigue en vigor. La plantilla de la estación viaja aparte (`stationAgents`) como contexto. El Excel y
  el PDF suman «Sin habilitación vigente» y «% habilitados».
- **Permiso de exportar.** Gestión Humana comprueba «Exportar» (`AuthorizeExportAsync`) antes de leer o renderizar nada.
- **Porcentajes con un decimal** en los datos de Finanzas y en todos los documentos.

## Consecuencias

- **Un solo aspecto.** Todos los reportes se ven y se imprimen igual, y lo que se corrija en el motor llega a todas las
  áreas. Los reportes nuevos (Contratos, estado de cuenta, portal) y los documentos imprimibles se construyen sobre el
  mismo kit.
- **Sin migración.** El contrato HTTP solo crece: campos y parámetros nuevos, y una ruta nueva en Gestión Humana. El
  snapshot de OpenAPI y el cliente generado se refrescan.
- **Pantallas.** Las nuevas, con los filtros, los totales y el resumen, son de otro PR; este solo ajusta lo que deje de
  compilar.
- **Totales que no suman.** No se suman columnas sin sentido: tiempos por operación, cantidades de unidades distintas y
  conteos por equipo que repetirían agentes.
- **Revisión visual.** `ReportSamplesHarness` genera, con `ELEVANT_REPORT_SAMPLES_DIR`, un PDF y un Excel de cada reporte
  con datos sintéticos. Las pruebas leen el PDF (`PdfFontInspector`) y el Excel (OpenXml, con `OpenXmlValidator`).

## Reportes nuevos (PR C, 21 de noviembre de 2026)

Para la revisión de reportes, el motor suma una batería de reportes de Contratos, Finanzas, Gestión Humana y el
portal de aerolíneas. Depende de este ADR y del PR E (documentos imprimibles).

**1. Reportes tabulares comunes (`TabularReports`, `TabularReportEndpoint`).**
- **Definición:** cada reporte declara su clave, título, descripción, columnas tipadas, filtros con nombre
  (`station`, `airline`, `service`, `select` con opciones o `days`) y cómo lee el calendario: `none`, `range`
  (`from`–`to`, 366 días como máximo, 92 en la trazabilidad) o `asOf` (lee `to`, hoy sin él).
- **Consulta:** se valida contra la definición antes de leer (400 `invalid_report_query`). Un filtro de otro reporte,
  un id vacío o una opción desconocida se rechazan. Las pantallas envían `from` y `to` siempre: un reporte a fecha de
  corte ignora `from`, y un reporte puede ignorar parámetros comunes del área (`IgnoredParameters`).
- **Pantalla:** `GET …/{clave}` devuelve una página (`limit` 1–100) con `totalRows`, `totals`, `summary`,
  `appliedFilters`, `notes`, `stationCode`/`stationName` y `generatedBy`, todos de las filas completas.
- **Exportación:** `GET …/{clave}/export?format=pdf|xlsx|csv`.
  - «Exportar» se comprueba antes de leer.
  - El PDF admite 5 000 filas y el Excel y el CSV, 25 000; por encima, 422 `report_too_large`.
  - Cada exportación queda auditada como `{área}.report.exported`, con el reporte, el formato, el período, los
    filtros y las filas.
- **Pie del PDF:** `ReportDocument.Audience` dice para quién es: «Uso interno» o «Documento para la aerolínea».

**2. Contratos** (`ContractsReportsController`, `api/v1/contracts/reports`, permiso `contracts.reports.read`).
Contratos no tiene una opción «Exportar», así que el mismo permiso exporta.
- **Contratos y vigencias** (a fecha de corte): la versión que rige o la más reciente, con vigencia, días para vencer,
  estaciones, moneda y número de tarifas. Filtros: aerolínea, estado, estación y «vence en N días».
- **Tarifas pactadas:** las de las versiones aprobadas. Filtros: aerolínea, servicio y estación.
- **Solicitudes comerciales** (período): recibida, estado, decidida el/por y servicios. Filtros: estado, aerolínea y
  estación.
- **Permisos de aerolíneas** (a fecha de corte): vigencia, revisión y revisado el/por. Filtros: revisión,
  vencimiento y aerolínea.

**3. Finanzas.**
- **Catálogo:** «Facturas emitidas» (`invoices`, con el filtro `status`: pendiente, vencida, pagada, anulada o con
  saldo) y «Cobros» (`receipts`: recibido, aplicado, devuelto y remanente) entran en `FinanceReports.All`, con la
  pantalla y las exportaciones de Finanzas.
- **Estado de cuenta:** `GET finance/statements/export?format=pdf|xlsx&asOf&airlineId&stationId&currency`, con el
  permiso de `GET finance/statements`.
  - **PDF:** el documento imprimible del PR E (`IStatementDocumentRenderer`), en una moneda: la pedida o la de más
    facturas.
  - **Excel:** sale del motor, con todas las monedas.
  - **Contenido:** los movimientos con su saldo acumulado por moneda y la antigüedad de saldos como resumen.
    Aplicar un cobro no mueve el saldo, porque el cobro ya se abonó.

**4. Gestión Humana** (`api/v1/human-resources/table-reports`).
- **Plantilla de personal** y **Trazabilidad y auditoría**, con las acciones en español (`AuditActionLabels`).
- Leen por los almacenes de «Empleados» y «Trazabilidad / Auditoría», con sus mismas reglas.
- Para leer hace falta «Reportes»; para exportar, «Exportar».

**5. Portal de aerolíneas** (`api/v1/airline/portal/reports`).
- **Reportes:** «Operaciones y servicios» (los servicios aprobados por AVIAM con cantidad y unidad), «Facturas y
  pagos» y «Estado de cuenta» (el mismo documento de Finanzas).
- **Alcance:** siempre de la aerolínea de la sesión y de las estaciones de sus contratos.
  - Otra estación responde 404 `station_unavailable`.
  - Sin el rol del portal, o con más de una aerolínea, responde 403.
  - El portal no tiene parámetro de aerolínea.
- **Detalle de factura:** `treasury/invoices/{id}` suma `netAmount` y `taxAmount` por línea (aditivo).

**Consecuencias.** No hay migración, y el contrato HTTP solo crece. El cliente (`packages/api-client`) expone
`listContractReports`, `getContractReport` y `exportContractReport`, sus equivalentes de Gestión Humana y del portal,
y `exportFinanceStatement`. Las pantallas internas de AVIAM Web son de otro PR (D). El portal ya descarga sus
reportes y el estado de cuenta.

